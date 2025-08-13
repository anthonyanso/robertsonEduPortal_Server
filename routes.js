"use strict";
const { createServer } = require("http");
const { storage } = require("./storage");
const { setupSimpleAdminAuth } = require("./simpleAdminRoutes");
// Removed all imports from ../shared/schema. Use storage.js and db.js for all database and schema operations.
const { z } = require("zod");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateUniqueStudentId } = require("./utils/studentIdGenerator");
const JWT_SECRET = process.env.SESSION_SECRET || "fallback-secret-for-dev";
const { query, pool } = require("./db");
const fileUpload = require("express-fileupload");
const { put } = require("@vercel/blob");
const path = require("path");
// Removed students import from ../shared/schema. Use storage.js and db.js for all database operations.
// Removed drizzle-orm eq import
const multer = require("multer");
const fs = require("fs");
let nanoid;
(async () => {
  ({ nanoid } = await import("nanoid"));
})();
// Remove usage of app outside the registerRoutes function
// Function to calculate subject positions for each subject across all students
async function calculateSubjectPositions(className, session, term) {
  try {
    // Get all results for the same class, session, and term
    const allResults = await storage.getResults();
    const classResults = allResults.filter(
      (result) =>
        result.class === className &&
        result.session === session &&
        result.term === term
    );
    if (classResults.length === 0) return;
    // Get all unique subjects from all students
    const allSubjects = new Set();
    classResults.forEach((result) => {
      if (result.subjects && Array.isArray(result.subjects)) {
        result.subjects.forEach((subject) => {
          if (subject.subject) {
            allSubjects.add(subject.subject);
          }
        });
      }
    });
    // Calculate positions for each subject
    for (const subjectName of allSubjects) {
      // Get all students' scores for this subject
      const subjectScores = [];
      classResults.forEach((result) => {
        if (result.subjects && Array.isArray(result.subjects)) {
          result.subjects.forEach((subject, index) => {
            if (
              subject.subject === subjectName &&
              subject.total !== undefined
            ) {
              subjectScores.push({
                studentId: result.studentId,
                resultId: result.id,
                total: parseInt(subject.total) || 0,
                subjectIndex: index,
              });
            }
          });
        }
      });
      // Sort by total score (descending) for position calculation
      subjectScores.sort((a, b) => b.total - a.total);
      // Update each student's position for this subject
      for (let i = 0; i < subjectScores.length; i++) {
        const { resultId, subjectIndex } = subjectScores[i];
        const position = i + 1;
        // Get the current result to update
        const currentResult = classResults.find((r) => r.id === resultId);
        if (
          currentResult &&
          currentResult.subjects &&
          currentResult.subjects[subjectIndex]
        ) {
          // Update the position for this specific subject
          currentResult.subjects[subjectIndex].position = position;
          // Save the updated result back to database
          await storage.updateResult(resultId, {
            subjects: currentResult.subjects,
          });
        }
      }
    }
    console.log(
      `Updated subject positions for ${classResults.length} students in ${className} - ${session} ${term}`
    );
  } catch (error) {
    console.error("Error calculating subject positions:", error);
  }
}
// Function to calculate class positions based on performance
async function calculateClassPositions(className, session, term) {
  try {
    // Get all results for the same class, session, and term
    const allResults = await storage.getResults();
    const classResults = allResults.filter(
      (result) =>
        result.class === className &&
        result.session === session &&
        result.term === term
    );
    // Sort by average score (descending)
    const sortedResults = classResults.sort((a, b) => {
      const avgA = parseFloat(a.average) || 0;
      const avgB = parseFloat(b.average) || 0;
      return avgB - avgA;
    });
    // Update positions
    for (let i = 0; i < sortedResults.length; i++) {
      const result = sortedResults[i];
      await storage.updateResult(result.id, {
        position: i + 1,
        outOf: sortedResults.length,
      });
    }
    console.log(
      `Updated positions for ${sortedResults.length} students in ${className} - ${session} ${term}`
    );
  } catch (error) {
    console.error("Error calculating class positions:", error);
  }
}
// Maintenance mode middleware
async function checkMaintenanceMode(req, res, next) {
  var _a;
  // Skip maintenance mode check for:
  // - Admin routes and auth routes
  // - Static assets (CSS, JS, images, etc.)
  // - Frontend routes (non-API routes)
  if (
    req.path.startsWith("/api/admin") ||
    req.path.startsWith("/api/auth") ||
    req.path.startsWith("/api/login") ||
    req.path === "/api/admin/school-info" ||
    req.path.startsWith("/assets") ||
    req.path.startsWith("/uploads") ||
    req.path.endsWith(".js") ||
    req.path.endsWith(".css") ||
    req.path.endsWith(".png") ||
    req.path.endsWith(".jpg") ||
    req.path.endsWith(".svg") ||
    req.path.endsWith(".ico") ||
    !req.path.startsWith("/api")
  ) {
    return next();
  }
  try {
    // Check maintenance mode setting - only for public API routes
    const settings = await storage.getSchoolSettings();
    const maintenanceMode =
      (_a = settings.find((s) => s.key === "maintenance_mode")) === null ||
      _a === void 0
        ? void 0
        : _a.value;
    if (maintenanceMode === "true") {
      return res.status(503).json({
        error: "Service Temporarily Unavailable",
        message:
          "The website is currently under maintenance. Please try again later.",
        maintenanceMode: true,
      });
    }
    next();
  } catch (error) {
    // If we can't check settings, allow access to prevent breaking the site
    console.error("Error checking maintenance mode:", error);
    next();
  }
}
// Note: Temporarily removing auth middleware to fix corruption
// Configure multer for file uploads
// Vercel Blob will be used for uploads. Local uploads directory creation removed.
const uploadsDir = null; // Not used with Vercel Blob
const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${nanoid()}-${Date.now()}${path.extname(
      file.originalname
    )}`;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage: storage_multer,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and GIF are allowed."));
    }
  },
});
function registerRoutes(app) {
  app.use(fileUpload());
  // ...existing code...
  // Setup enhanced admin authentication system (Session + JWT)
  const requireAdminAuth = setupSimpleAdminAuth(app);
  // Admin registration route (before maintenance mode check)
  app.post("/api/admin/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({ message: "All fields are required" });
      }
      // Check if admin already exists
      const existingUser = await storage.getAdminUserByEmail(email);
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "Admin with this email already exists" });
      }
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      // Create admin user
      const adminUser = await storage.createAdminUser({
        email,
        firstName,
        lastName,
        passwordHash: hashedPassword,
        role: "admin",
        isActive: true,
      });
      res.status(201).json({
        message: "Admin registered successfully",
        admin: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
        },
      });
    } catch (error) {
      console.error("Admin registration error:", error);
      res.status(500).json({ message: "Failed to register admin" });
    }
  });
  // Note: Admin login is now handled by simpleAdminRoutes system
  // Apply maintenance mode middleware to all public routes
  app.use(checkMaintenanceMode);
  // Serve uploaded files
  app.use("/uploads", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
  });
  app.get("/uploads/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      // Set appropriate content type
      const ext = path.extname(filename).toLowerCase();
      const contentType =
        {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
        }[ext] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "File not found" });
    }
  });
  // Admin authentication routes
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { firstName, lastName, email, password, adminCode } = req.body;
      // Basic validation
      if (!firstName || !lastName || !email || !password || !adminCode) {
        return res.status(400).json({ message: "All fields are required" });
      }
      // Check admin code
      if (adminCode !== "ROBERTSON2024") {
        return res.status(400).json({ message: "Invalid admin code" });
      }
      // Check if email already exists
      const existingUser = await storage.getAdminUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already exists" });
      }
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      // Create admin user
      const adminUser = await storage.createAdminUser({
        email,
        firstName,
        lastName,
        passwordHash: hashedPassword,
        role: "admin",
        isActive: true,
      });
      // Store in session
      req.session.adminUser = {
        id: adminUser.id,
        email: adminUser.email,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        role: adminUser.role,
        isActive: adminUser.isActive,
      };
      res.json({
        message: "Admin account created successfully",
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
        },
      });
    } catch (error) {
      console.error("Error creating admin user:", error);
      res.status(500).json({ message: "Failed to create admin account" });
    }
  });
  app.post("/api/auth/signin", async (req, res) => {
    try {
      const { email, password } = req.body;
      // Find admin user
      const adminUser = await storage.getAdminUserByEmail(email);
      if (!adminUser) {
        return res.status(400).json({ message: "Invalid credentials" });
      }
      // Check password
      const isValidPassword = await bcrypt.compare(
        password,
        adminUser.passwordHash
      );
      if (!isValidPassword) {
        return res.status(400).json({ message: "Invalid credentials" });
      }
      // Store in session
      req.session.adminUser = {
        id: adminUser.id,
        email: adminUser.email,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        role: adminUser.role,
        isActive: adminUser.isActive,
      };
      res.json({
        message: "Signed in successfully",
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
        },
      });
    } catch (error) {
      console.error("Error signing in:", error);
      res.status(500).json({ message: "Failed to sign in" });
    }
  });
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });
  // Test endpoint to check admin user
  app.get("/api/auth/test", async (req, res) => {
    try {
      const adminUser = await storage.getAdminUserByEmail(
        "admin@robertsoneducation.com"
      );
      res.json({
        exists: !!adminUser,
        user: adminUser
          ? {
              id: adminUser.id,
              email: adminUser.email,
              firstName: adminUser.firstName,
              lastName: adminUser.lastName,
            }
          : null,
      });
    } catch (error) {
      console.error("Error checking admin user:", error);
      res.status(500).json({ message: "Failed to check admin user" });
    }
  });
  // Public endpoint to check if anyone is logged in (removed - not needed for pure admin system)
  // Test route for student creation (no auth required)
  app.post("/api/test/students", async (req, res) => {
    try {
      console.log("Received student data:", req.body);
      // Generate unique student ID
      const studentId = await generateUniqueStudentId();
      // Create student with auto-generated ID - directly using SQL insert
      const studentData = {
        studentId: studentId,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email || null,
        phone: req.body.phone || null,
        dateOfBirth: req.body.dateOfBirth || null,
        gender: req.body.gender || null,
        nationality: req.body.nationality || null,
        address: req.body.address || null,
        gradeLevel: req.body.gradeLevel || null,
        fatherName: req.body.fatherName || null,
        motherName: req.body.motherName || null,
        guardianPhone: req.body.guardianPhone || null,
        guardianEmail: req.body.guardianEmail || null,
        medicalConditions: req.body.medicalConditions || null,
        specialNeeds: req.body.specialNeeds || null,
      };
      console.log("Creating student with data:", studentData);
      // Insert directly into database using raw SQL
      const result = await query(
        `INSERT INTO students (
          student_id, first_name, last_name, email, phone, date_of_birth, gender,
          nationality, address, grade_level, father_name, mother_name,
          guardian_phone, guardian_email, medical_conditions, special_needs
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        ) RETURNING *`,
        [
          studentId,
          studentData.firstName,
          studentData.lastName,
          studentData.email,
          studentData.phone,
          studentData.dateOfBirth,
          studentData.gender,
          studentData.nationality,
          studentData.address,
          studentData.gradeLevel,
          studentData.fatherName,
          studentData.motherName,
          studentData.guardianPhone,
          studentData.guardianEmail,
          studentData.medicalConditions,
          studentData.specialNeeds,
        ]
      );
      const student = Object.assign(Object.assign({}, studentData), {
        studentId,
        id: Date.now(),
      });
      console.log("Student created successfully:", student);
      res.json(student);
    } catch (error) {
      console.error("Error creating student:", error);
      res
        .status(500)
        .json({ message: error.message || "Failed to create student" });
    }
  });
  // Get students test route
  app.get("/api/test/students", async (req, res) => {
    try {
      const result = await query(
        "SELECT * FROM students ORDER BY created_at DESC"
      );
      // Map database fields to frontend expected format
      const students = result.rows.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        email: row.email || "",
        phone: row.phone || "",
        dateOfBirth: row.date_of_birth,
        gender: row.gender || "",
        nationality: row.nationality || "",
        address: row.address || "",
        gradeLevel: row.grade_level || "",
        fatherName: row.father_name || "",
        motherName: row.mother_name || "",
        guardianPhone: row.guardian_phone || "",
        guardianEmail: row.guardian_email || "",
        medicalConditions: row.medical_conditions || "",
        specialNeeds: row.special_needs || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        // Add additional fields expected by frontend
        phoneNumber: row.phone || "",
        parentGuardianName: row.father_name || "",
        parentGuardianPhone: row.guardian_phone || "",
        parentGuardianEmail: row.guardian_email || "",
        emergencyContact: row.guardian_phone || "",
        enrollmentDate: row.created_at,
        status: row.status || "active",
      }));
      res.json(students);
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });
  // Public routes
  // News routes
  app.get("/api/news", async (req, res) => {
    try {
      const news = await storage.getPublishedNews();
      res.json(news);
    } catch (error) {
      console.error("Error fetching news:", error);
      res.status(500).json({ message: "Failed to fetch news" });
    }
  });
  app.get("/api/news/category/:category", async (req, res) => {
    try {
      const { category } = req.params;
      const news = await storage.getNewsByCategory(category);
      res.json(news);
    } catch (error) {
      console.error("Error fetching news by category:", error);
      res.status(500).json({ message: "Failed to fetch news by category" });
    }
  });
  app.get("/api/news/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const newsItem = await storage.getNewsItem(id);
      if (!newsItem) {
        return res.status(404).json({ message: "News item not found" });
      }
      res.json(newsItem);
    } catch (error) {
      console.error("Error fetching news item:", error);
      res.status(500).json({ message: "Failed to fetch news item" });
    }
  });
  // Admission application route
  app.post("/api/admission", async (req, res) => {
    try {
      // Directly use req.body for admission application, or add validation here if needed
      const application = await storage.createAdmissionApplication(req.body);
      res.json(application);
    } catch (error) {
      console.error("Error creating admission application:", error);
      res
        .status(500)
        .json({ message: "Failed to create admission application" });
    }
  });
  // School info route
  app.get("/api/school-info", async (req, res) => {
    try {
      const schoolInfo = await storage.getSchoolInfo();
      res.json(schoolInfo);
    } catch (error) {
      console.error("Error fetching school info:", error);
      res.status(500).json({ message: "Failed to fetch school info" });
    }
  });
  // Admin News Management Routes
  // app.get("/api/admin/news", requireAdminAuth, async (req, res) => {
  //   try {
  //     const news = await storage.getNews();
  //     res.json(news);
  //   } catch (error) {
  //     console.error("Error fetching admin news:", error);
  //     res.status(500).json({ message: "Failed to fetch news" });
  //   }
  // });
  app.post("/api/admin/news", requireAdminAuth, async (req, res) => {
    try {
      const { title, content, author, category, published } = req.body;
      if (!title || !content || !author || !category) {
        return res.status(400).json({
          message: "Title, content, author, and category are required",
        });
      }
      let imageUrl = null;
      if (req.files && req.files.image) {
        // Vercel Blob upload
        const file = req.files.image;
        const blob = await put(file.name, file.data, { access: "public" });
        imageUrl = blob.url;
      }
      const newsData = {
        title,
        content,
        author,
        category,
        published: published === "true",
        imageUrl,
      };
      const news = await storage.createNews(newsData);
      res.json(news);
    } catch (error) {
      console.error("Error creating news:", error);
      res.status(500).json({ message: "Failed to create news article" });
    }
  });
  app.post(
    "/api/admin/news",
    requireAdminAuth,
    upload.single("image"),
    async (req, res) => {
      try {
        const { title, content, author, category, published } = req.body;
        if (!title || !content || !author || !category) {
          return res.status(400).json({
            message: "Title, content, author, and category are required",
          });
        }
        let imageUrl = null;
        if (req.file) {
          imageUrl = `/uploads/${req.file.filename}`;
        }
        const newsData = {
          title,
          content,
          author,
          category,
          published: published === "true",
          imageUrl,
        };
        // Directly use newsData for news creation, or add validation here if needed
        const news = await storage.createNews(newsData);
        res.json(news);
      } catch (error) {
        console.error("Error creating news:", error);
        res.status(500).json({ message: "Failed to create news article" });
      }
    }
  );
  app.put(
    "/api/admin/news/:id",
    requireAdminAuth,
    upload.single("image"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { title, content, author, category, published } = req.body;
        if (!title || !content || !author || !category) {
          return res.status(400).json({
            message: "Title, content, author, and category are required",
          });
        }
        const updateData = {
          title,
          content,
          author,
          category,
          published: published === "true",
        };
        if (req.file) {
          updateData.imageUrl = `/uploads/${req.file.filename}`;
        }
        const news = await storage.updateNews(id, updateData);
        res.json(news);
      } catch (error) {
        console.error("Error updating news:", error);
        res.status(500).json({ message: "Failed to update news article" });
      }
    }
  );
  app.delete("/api/admin/news/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Get the news item first to remove the image file
      const newsItem = await storage.getNewsItem(id);
      if (newsItem && newsItem.imageUrl) {
        const imagePath = path.join(process.cwd(), newsItem.imageUrl);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }
      await storage.deleteNews(id);
      res.json({ message: "News article deleted successfully" });
    } catch (error) {
      console.error("Error deleting news:", error);
      res.status(500).json({ message: "Failed to delete news article" });
    }
  });
  // Create admin session for testing
  app.post("/api/auth/admin-session", async (req, res) => {
    try {
      // Find any admin user to create a session with
      const adminUser = await storage.getAdminUserByEmail(
        "admin@robertsoneducation.com"
      );
      if (!adminUser) {
        return res.status(404).json({ message: "No admin user found" });
      }
      // Store in session
      req.session.adminUser = {
        id: adminUser.id,
        email: adminUser.email,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        role: adminUser.role,
        isActive: adminUser.isActive,
      };
      res.json({
        message: "Admin session created successfully",
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
        },
      });
    } catch (error) {
      console.error("Error creating admin session:", error);
      res.status(500).json({ message: "Failed to create admin session" });
    }
  });
  // Protected admin routes
  app.get("/api/admin/students", requireAdminAuth, async (req, res) => {
    try {
      const result = await query(
        "SELECT * FROM students ORDER BY created_at DESC"
      );
      // Map database fields to frontend expected format (same as test endpoint)
      const students = result.rows.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        email: row.email || "",
        phone: row.phone || "",
        dateOfBirth: row.date_of_birth,
        gender: row.gender || "",
        nationality: row.nationality || "",
        address: row.address || "",
        gradeLevel: row.grade_level || "",
        fatherName: row.father_name || "",
        motherName: row.mother_name || "",
        guardianPhone: row.guardian_phone || "",
        guardianEmail: row.guardian_email || "",
        medicalConditions: row.medical_conditions || "",
        specialNeeds: row.special_needs || "",
        passportPhoto: row.passport_photo || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        // Add additional fields expected by frontend
        phoneNumber: row.phone || "",
        parentGuardianName: row.father_name || "",
        parentGuardianPhone: row.guardian_phone || "",
        parentGuardianEmail: row.guardian_email || "",
        emergencyContact: row.guardian_phone || "",
        enrollmentDate: row.created_at,
        status: row.status || "active",
      }));
      res.json(students);
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  });
  // Serve student passport photos
  app.get("/api/student-photo/:studentId", async (req, res) => {
    try {
      const studentId = req.params.studentId;
      console.log("Fetching photo for student ID:", studentId);
      // Use pool.query to avoid Drizzle ORM issues
      const result = await pool.query(
        "SELECT passport_photo FROM students WHERE student_id = $1",
        [studentId]
      );
      if (result.rows.length === 0 || !result.rows[0].passport_photo) {
        console.log("No photo found for student:", studentId);
        return res.status(404).json({ message: "Photo not found" });
      }
      const passportPhoto = result.rows[0].passport_photo;
      console.log("Found photo, length:", passportPhoto.length);
      // Extract the base64 data and mime type
      const matches = passportPhoto.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches) {
        console.log("Invalid photo format for student:", studentId);
        return res.status(400).json({ message: "Invalid photo format" });
      }
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");
      res.set({
        "Content-Type": mimeType,
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=3600",
      });
      res.send(buffer);
    } catch (error) {
      console.error("Error serving student photo:", error);
      res.status(500).json({ message: "Failed to serve photo" });
    }
  });
  // Serve news images
  app.get("/api/news-image/:newsId", async (req, res) => {
    try {
      const newsId = req.params.newsId;
      console.log("Fetching image for news ID:", newsId);
      // Use pool.query to avoid Drizzle ORM issues
      const result = await pool.query(
        "SELECT image_url FROM news WHERE id = $1",
        [parseInt(newsId)]
      );
      if (result.rows.length === 0 || !result.rows[0].image_url) {
        console.log("No image found for news:", newsId);
        return res.status(404).json({ message: "Image not found" });
      }
      const imageUrl = result.rows[0].image_url;
      console.log("Found image, length:", imageUrl.length);
      // Check if it's a file path (uploaded file) or base64 data
      if (imageUrl.startsWith("/uploads/")) {
        // Handle file path - serve the uploaded file
        const filePath = path.join(process.cwd(), imageUrl);
        console.log("Serving file from:", filePath);
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        } else {
          console.log("File not found:", filePath);
          return res.status(404).json({ message: "Image file not found" });
        }
      } else {
        // Handle base64 data
        const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) {
          console.log("Invalid image format for news:", newsId);
          return res.status(400).json({ message: "Invalid image format" });
        }
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");
        res.set({
          "Content-Type": mimeType,
          "Content-Length": buffer.length,
          "Cache-Control": "public, max-age=3600",
        });
        res.send(buffer);
      }
    } catch (error) {
      console.error("Error serving news image:", error);
      res.status(500).json({ message: "Failed to serve image" });
    }
  });
  // Serve news images
  app.get("/api/news-image/:newsId", async (req, res) => {
    try {
      const newsId = parseInt(req.params.newsId);
      console.log("Fetching image for news ID:", newsId);
      // Get news item from database
      const newsItem = await storage.getNewsItem(newsId);
      if (!newsItem) {
        console.log("No news item found for ID:", newsId);
        return res.status(404).json({ message: "News item not found" });
      }
      if (!newsItem.imageUrl) {
        console.log("No image URL for news ID:", newsId);
        return res.status(404).json({ message: "No image found" });
      }
      // If it's a file path, serve the file
      if (newsItem.imageUrl.startsWith("/uploads/")) {
        const filePath = path.join(process.cwd(), newsItem.imageUrl);
        console.log("Serving file from path:", filePath);
        if (fs.existsSync(filePath)) {
          const ext = path.extname(newsItem.imageUrl).toLowerCase();
          const contentType =
            {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
            }[ext] || "application/octet-stream";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.sendFile(filePath);
        } else {
          console.log("Image file not found:", filePath);
          return res.status(404).json({ message: "Image file not found" });
        }
      } else {
        // If it's base64 data, handle it
        const matches = newsItem.imageUrl.match(
          /^data:([A-Za-z-+\/]+);base64,(.+)$/
        );
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, "base64");
          res.set({
            "Content-Type": mimeType,
            "Content-Length": buffer.length,
            "Cache-Control": "public, max-age=3600",
          });
          res.send(buffer);
        } else {
          console.log("Invalid image format for news ID:", newsId);
          return res.status(400).json({ message: "Invalid image format" });
        }
      }
    } catch (error) {
      console.error("Error serving news image:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  // app.post("/api/admin/students", requireAdminAuth, async (req, res) => {
  //   try {    const multer = require("multer");
  //   const path = require("path");
  //   const fs = require("fs");
  //   // ...existing code...
  //   const upload = multer({
  //     storage: storage_multer,
  //     limits: {
  //       fileSize: 5 * 1024 * 1024, // 5MB limit
  //     },
  //     fileFilter: (req, file, cb) => {
  //       const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
  //       if (allowedTypes.includes(file.mimetype)) {
  //         cb(null, true);
  //       } else {
  //         cb(new Error("Invalid file type. Only JPEG, PNG, and GIF are allowed."));
  //       }
  //     },
  //   });
  //     const validatedData = insertStudentSchema.parse(req.body);
  //     // Generate unique student ID
  //     const studentId = await generateUniqueStudentId();
  //     // Create student with auto-generated ID
  //     const studentData = Object.assign(Object.assign({}, validatedData), {
  //       studentId: studentId,
  //     });
  //     const student = await storage.createStudent(studentData);
  //     res.json(student);
  //   } catch (error) {
  //     console.error("Error creating student:", error);
  //     res.status(500).json({ message: "Failed to create student" });
  //   }
  // });

  app.put("/api/admin/students/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log("Updating student with ID:", id);
      console.log("Update data:", req.body);
      // Map frontend fields to database fields
      const updateData = {};
      if (req.body.firstName) updateData.firstName = req.body.firstName;
      if (req.body.lastName) updateData.lastName = req.body.lastName;
      if (req.body.email) updateData.email = req.body.email;
      if (req.body.phone || req.body.phoneNumber)
        updateData.phone = req.body.phone || req.body.phoneNumber;
      if (req.body.dateOfBirth) updateData.dateOfBirth = req.body.dateOfBirth;
      if (req.body.gender) updateData.gender = req.body.gender;
      if (req.body.nationality) updateData.nationality = req.body.nationality;
      if (req.body.address) updateData.address = req.body.address;
      if (req.body.gradeLevel) updateData.gradeLevel = req.body.gradeLevel;
      if (req.body.fatherName || req.body.parentGuardianName)
        updateData.fatherName =
          req.body.fatherName || req.body.parentGuardianName;
      if (req.body.motherName) updateData.motherName = req.body.motherName;
      if (req.body.guardianPhone || req.body.parentGuardianPhone)
        updateData.guardianPhone =
          req.body.guardianPhone || req.body.parentGuardianPhone;
      if (req.body.guardianEmail || req.body.parentGuardianEmail)
        updateData.guardianEmail =
          req.body.guardianEmail || req.body.parentGuardianEmail;
      if (req.body.medicalConditions)
        updateData.medicalConditions = req.body.medicalConditions;
      if (req.body.specialNeeds)
        updateData.specialNeeds = req.body.specialNeeds;
      if (req.body.status) updateData.status = req.body.status;
      if (req.body.passportPhoto !== undefined)
        updateData.passportPhoto = req.body.passportPhoto;
      console.log("Mapped update data:", updateData);
      // Use storage interface which handles the database mapping
      const student = await storage.updateStudent(id, updateData);
      console.log("Updated student:", student);
      res.json(student);
    } catch (error) {
      console.error("Error updating student:", error);
      res.status(500).json({ message: "Failed to update student" });
    }
  });
  app.delete("/api/admin/students/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStudent(id);
      res.json({ message: "Student deleted successfully" });
    } catch (error) {
      console.error("Error deleting student:", error);
      res.status(500).json({ message: "Failed to delete student" });
    }
  });
  // Admin results routes
  app.get("/api/admin/results", requireAdminAuth, async (req, res) => {
    try {
      const results = await storage.getResults();
      res.json(results);
    } catch (error) {
      console.error("Error fetching results:", error);
      res.status(500).json({ message: "Failed to fetch results" });
    }
  });
  app.post("/api/admin/results", requireAdminAuth, async (req, res) => {
    try {
      const validatedData = insertResultSchema.parse(req.body);
      // Create the result first
      const result = await storage.createResult(validatedData);
      // Calculate subject positions for individual subjects
      await calculateSubjectPositions(
        validatedData.class,
        validatedData.session,
        validatedData.term
      );
      // Calculate class position based on average performance
      await calculateClassPositions(
        validatedData.class,
        validatedData.session,
        validatedData.term
      );
      res.json(result);
    } catch (error) {
      console.error("Error creating result:", error);
      res.status(500).json({ message: "Failed to create result" });
    }
  });
  app.put("/api/admin/results/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertResultSchema.partial().parse(req.body);
      const result = await storage.updateResult(id, validatedData);
      // Recalculate positions if class, session, term, or subjects are updated
      if (
        validatedData.class ||
        validatedData.session ||
        validatedData.term ||
        validatedData.subjects
      ) {
        const fullResult = await storage.getResult(id);
        if (fullResult) {
          await calculateSubjectPositions(
            fullResult.class,
            fullResult.session,
            fullResult.term
          );
          await calculateClassPositions(
            fullResult.class,
            fullResult.session,
            fullResult.term
          );
        }
      }
      res.json(result);
    } catch (error) {
      console.error("Error updating result:", error);
      res.status(500).json({ message: "Failed to update result" });
    }
  });
  // Add endpoint to recalculate class positions
  app.post(
    "/api/admin/results/recalculate-positions",
    requireAdminAuth,
    async (req, res) => {
      try {
        const { class: className, session, term } = req.body;
        if (!className || !session || !term) {
          return res
            .status(400)
            .json({ message: "Class, session, and term are required" });
        }
        await calculateSubjectPositions(className, session, term);
        await calculateClassPositions(className, session, term);
        res.json({ message: "Positions recalculated successfully" });
      } catch (error) {
        console.error("Error recalculating positions:", error);
        res.status(500).json({ message: "Failed to recalculate positions" });
      }
    }
  );
  // Add endpoint to recalculate all positions for all results
  app.post(
    "/api/admin/results/recalculate-all-positions",
    requireAdminAuth,
    async (req, res) => {
      try {
        const allResults = await storage.getResults();
        // Group results by class, session, and term
        const resultGroups = new Map();
        allResults.forEach((result) => {
          const key = `${result.class}-${result.session}-${result.term}`;
          if (!resultGroups.has(key)) {
            resultGroups.set(key, []);
          }
          resultGroups.get(key).push(result);
        });
        // Recalculate positions for each group
        for (const [key, group] of resultGroups) {
          if (group.length > 0) {
            const { class: className, session, term } = group[0];
            await calculateSubjectPositions(className, session, term);
            await calculateClassPositions(className, session, term);
          }
        }
        res.json({
          message: "All positions recalculated successfully",
          groupsProcessed: resultGroups.size,
        });
      } catch (error) {
        console.error("Error recalculating all positions:", error);
        res
          .status(500)
          .json({ message: "Failed to recalculate all positions" });
      }
    }
  );
  app.delete("/api/admin/results/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteResult(id);
      res.json({ message: "Result deleted successfully" });
    } catch (error) {
      console.error("Error deleting result:", error);
      res.status(500).json({ message: "Failed to delete result" });
    }
  });
  // Admin scratch cards routes
  app.get("/api/admin/scratch-cards", requireAdminAuth, async (req, res) => {
    try {
      const scratchCards = await storage.getScratchCards();
      res.json(scratchCards);
    } catch (error) {
      console.error("Error fetching scratch cards:", error);
      res.status(500).json({ message: "Failed to fetch scratch cards" });
    }
  });
  app.post(
    "/api/admin/scratch-cards/generate",
    requireAdminAuth,
    async (req, res) => {
      try {
        const { count = 1, durationMonths = 3, maxUsage = 30 } = req.body;
        const scratchCards = [];
        for (let i = 0; i < count; i++) {
          const serialNumber = `ROB-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 8)
            .toUpperCase()}`;
          const pin = Math.random().toString(36).substr(2, 12).toUpperCase();
          const pinHash = await bcrypt.hash(pin, 10);
          const expiryDate = new Date();
          expiryDate.setMonth(expiryDate.getMonth() + durationMonths);
          scratchCards.push({
            serialNumber,
            pin,
            pinHash,
            status: "unused",
            expiryDate,
            usageLimit: maxUsage, // Use dynamic maxUsage from settings
            usageCount: 0,
          });
        }
        const createdCards = await storage.createScratchCards(scratchCards);
        res.json(createdCards);
      } catch (error) {
        console.error("Error generating scratch cards:", error);
        res.status(500).json({ message: "Failed to generate scratch cards" });
      }
    }
  );
  app.delete(
    "/api/admin/scratch-cards/:id",
    requireAdminAuth,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.deleteScratchCard(id);
        res.json({ message: "Scratch card deleted successfully" });
      } catch (error) {
        console.error("Error deleting scratch card:", error);
        res.status(500).json({ message: "Failed to delete scratch card" });
      }
    }
  );
  // Update scratch card status
  app.patch(
    "/api/admin/scratch-cards/:id/status",
    requireAdminAuth,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const { status } = req.body;
        if (!["unused", "used", "expired", "deactivated"].includes(status)) {
          return res.status(400).json({ message: "Invalid status" });
        }
        await storage.updateScratchCard(id, { status });
        res.json({ message: "Scratch card status updated successfully" });
      } catch (error) {
        console.error("Error updating scratch card status:", error);
        res
          .status(500)
          .json({ message: "Failed to update scratch card status" });
      }
    }
  );
  // Regenerate PIN
  app.post(
    "/api/admin/scratch-cards/:id/regenerate-pin",
    requireAdminAuth,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const pin = Math.random().toString(36).substr(2, 12).toUpperCase();
        const pinHash = await bcrypt.hash(pin, 10);
        await storage.updateScratchCard(id, {
          pin,
          pinHash,
          status: "unused",
          usageCount: 0,
          usedAt: null,
          usedBy: null,
        });
        res.json({ message: "PIN regenerated successfully" });
      } catch (error) {
        console.error("Error regenerating PIN:", error);
        res.status(500).json({ message: "Failed to regenerate PIN" });
      }
    }
  );
  // Get scratch card settings
  app.get(
    "/api/admin/scratch-card-settings",
    requireAdminAuth,
    async (req, res) => {
      try {
        const settings = await storage.getSchoolInfo();
        res.json(settings);
      } catch (error) {
        console.error("Error fetching scratch card settings:", error);
        res.status(500).json({ message: "Failed to fetch settings" });
      }
    }
  );
  // Save scratch card settings
  app.post(
    "/api/admin/scratch-card-settings",
    requireAdminAuth,
    async (req, res) => {
      try {
        const { defaultDuration, cardsPerBatch } = req.body;
        await storage.upsertSchoolInfo({
          key: "scratch_card_default_duration",
          value: defaultDuration.toString(),
        });
        await storage.upsertSchoolInfo({
          key: "scratch_card_batch_size",
          value: cardsPerBatch.toString(),
        });
        res.json({ message: "Settings saved successfully" });
      } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).json({ message: "Failed to save settings" });
      }
    }
  );
  // Public PIN verification endpoint with enhanced security
  app.post("/api/verify-scratch-card", async (req, res) => {
    var _a;
    try {
      // First check if result checker is enabled in settings
      const schoolInfo = await storage.getSchoolInfo();
      const enableResultChecker =
        ((_a = schoolInfo.find((s) => s.key === "enable_result_checker")) ===
          null || _a === void 0
          ? void 0
          : _a.value) === "true";
      if (!enableResultChecker) {
        return res.status(403).json({
          message:
            "Result checking system is currently disabled. Please contact the school administrator.",
        });
      }
      const { pin, studentId } = req.body;
      if (!pin || !studentId) {
        return res
          .status(400)
          .json({ message: "PIN and Student ID are required" });
      }
      // Verify student exists first
      const student = await storage.getStudentByStudentId(studentId);
      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      const card = await storage.getScratchCardByPin(pin);
      if (!card) {
        return res.status(404).json({ message: "Invalid PIN" });
      }
      // Check if card is expired
      if (new Date(card.expiryDate) < new Date()) {
        await storage.updateScratchCard(card.id, { status: "expired" });
        return res.status(400).json({ message: "Scratch card has expired" });
      }
      // Check if card is deactivated
      if (card.status === "deactivated") {
        return res
          .status(400)
          .json({ message: "Scratch card has been deactivated" });
      }
      // Check usage limit
      if ((card.usageCount || 0) >= (card.usageLimit || 30)) {
        return res
          .status(400)
          .json({ message: "Scratch card usage limit exceeded" });
      }
      // Verify PIN hash
      const isValidPin = await bcrypt.compare(pin, card.pinHash);
      if (!isValidPin) {
        return res.status(400).json({ message: "Invalid PIN" });
      }
      // Student binding logic: After first use, only that student can use the PIN
      if (card.studentId && card.studentId !== studentId) {
        return res.status(403).json({
          message:
            "This PIN is bound to another student and cannot be used by you.",
        });
      }
      // Update usage count and bind student if first use
      const newUsageCount = (card.usageCount || 0) + 1;
      const updateData = {
        usageCount: newUsageCount,
        usedAt: new Date(),
        usedBy: studentId,
      };
      // Bind student to card on first use
      if (!card.studentId) {
        updateData.studentId = studentId;
      }
      // Mark as 'used' if we've reached the usage limit
      if (newUsageCount >= (card.usageLimit || 30)) {
        updateData.status = "used";
      }
      await storage.updateScratchCard(card.id, updateData);
      // Get student results
      const results = await storage.getResults();
      const studentResults = results.filter((r) => r.studentId === studentId);
      res.json({
        message: "PIN verified successfully",
        student,
        results: studentResults,
        usageCount: newUsageCount,
        usageLimit: card.usageLimit || 30,
      });
    } catch (error) {
      console.error("Error verifying PIN:", error);
      res.status(500).json({ message: "Failed to verify PIN" });
    }
  });
  // Test endpoint for debugging
  app.get("/api/test-data", async (req, res) => {
    try {
      const students = await storage.getStudents();
      const results = await storage.getResults();
      const scratchCards = await storage.getScratchCards();
      res.json({
        students: students.slice(0, 3),
        results: results.slice(0, 3),
        scratchCards: scratchCards.map((card) => ({
          id: card.id,
          serialNumber: card.serialNumber,
          pin: card.pin,
          status: card.status,
          usageCount: card.usageCount,
          usageLimit: card.usageLimit || 30,
        })),
      });
    } catch (error) {
      console.error("Error fetching test data:", error);
      res.status(500).json({ message: "Failed to fetch test data" });
    }
  });
  // Admin admission applications
  app.get("/api/admin/admissions", requireAdminAuth, async (req, res) => {
    try {
      const applications = await storage.getAdmissionApplications();
      res.json(applications);
    } catch (error) {
      console.error("Error fetching admission applications:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch admission applications" });
    }
  });
  // Get admission settings for public display
  app.get("/api/admission-settings", async (req, res) => {
    try {
      const schoolInfo = await storage.getSchoolInfo();
      const admissionInfo = schoolInfo.find(
        (info) => info.key === "admission" || info.key === "admission_settings"
      );
      if (admissionInfo && admissionInfo.value) {
        const settings = JSON.parse(admissionInfo.value);
        res.json(settings);
      } else {
        // Default settings if none found
        const defaultSettings = {
          isOpen: true,
          startDate: "2025-01-01",
          endDate: "2025-03-31",
          maxApplications: 500,
          applicationFee: 5000,
          requirements:
            "Birth certificate, Previous school report, Passport photograph",
          availableClasses: ["JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"],
          contactEmail: "info@robertsoneducation.com",
          contactPhone: "+2348146373297",
        };
        res.json(defaultSettings);
      }
    } catch (error) {
      console.error("Error fetching admission settings:", error);
      res.status(500).json({ message: "Failed to fetch admission settings" });
    }
  });
  // Get public school settings for navigation and public pages
  app.get("/api/school-info", async (req, res) => {
    try {
      const settings = await storage.getSchoolInfo();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching public school info:", error);
      res.status(500).json({ message: "Failed to fetch school info" });
    }
  });
  app.put("/api/admin/admissions/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const validatedData = insertAdmissionApplicationSchema
        .partial()
        .parse(req.body);
      const application = await storage.updateAdmissionApplication(
        id,
        validatedData
      );
      res.json(application);
    } catch (error) {
      console.error("Error updating admission application:", error);
      res
        .status(500)
        .json({ message: "Failed to update admission application" });
    }
  });
  app.delete(
    "/api/admin/admissions/:id",
    requireAdminAuth,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        await storage.deleteAdmissionApplication(id);
        res.json({ message: "Admission application deleted successfully" });
      } catch (error) {
        console.error("Error deleting admission application:", error);
        res
          .status(500)
          .json({ message: "Failed to delete admission application" });
      }
    }
  );
  // Admin school info
  app.put("/api/admin/school-info", requireAdminAuth, async (req, res) => {
    try {
      const validatedData = insertSchoolInfoSchema.parse(req.body);
      const schoolInfo = await storage.upsertSchoolInfo(validatedData);
      res.json(schoolInfo);
    } catch (error) {
      console.error("Error updating school info:", error);
      res.status(500).json({ message: "Failed to update school info" });
    }
  });
  app.post("/api/admin/school-info", requireAdminAuth, async (req, res) => {
    try {
      const validatedData = insertSchoolInfoSchema.parse(req.body);
      const schoolInfo = await storage.upsertSchoolInfo(validatedData);
      res.json(schoolInfo);
    } catch (error) {
      console.error("Error creating school info:", error);
      res.status(500).json({ message: "Failed to create school info" });
    }
  });
  // Get all school info settings
  app.get("/api/admin/school-info", requireAdminAuth, async (req, res) => {
    try {
      const settings = await storage.getSchoolInfo();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching school info:", error);
      res.status(500).json({ message: "Failed to fetch school info" });
    }
  });
  // Regenerate PIN for student
  app.post(
    "/api/admin/scratch-cards/regenerate/:studentId",
    requireAdminAuth,
    async (req, res) => {
      try {
        const studentId = req.params.studentId;
        // Verify student exists
        const student = await storage.getStudentByStudentId(studentId);
        if (!student) {
          return res.status(404).json({ message: "Student not found" });
        }
        // Regenerate PIN for student
        const newCard = await storage.regeneratePinForStudent(studentId);
        res.json({
          message: "PIN regenerated successfully",
          scratchCard: {
            id: newCard.id,
            serialNumber: newCard.serialNumber,
            pin: newCard.pin,
            studentId: newCard.studentId,
            expiryDate: newCard.expiryDate,
            usageLimit: newCard.usageLimit,
            usageCount: newCard.usageCount,
            status: newCard.status,
          },
        });
      } catch (error) {
        console.error("Error regenerating PIN:", error);
        res.status(500).json({ message: "Failed to regenerate PIN" });
      }
    }
  );
  // No need to return httpServer in JS/Express usage
}
module.exports = { registerRoutes };
