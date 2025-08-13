const { storage } = require("./storage");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const session = require("express-session");
const JWT_SECRET = process.env.SESSION_SECRET || "fallback-secret-for-dev";
export function setupSimpleAdminAuth(app) {
    // Use memory store for sessions (simpler approach)
    app.use(session({
        secret: JWT_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false, // Set to true in production with HTTPS
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        }
    }));
    // Simple admin login with session support
    app.post('/api/admin/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: "Email and password are required" });
            }
            // Find admin by email
            const admin = await storage.getAdminUserByEmail(email);
            if (!admin || !admin.isActive) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            // Verify password
            const isValidPassword = await bcrypt.compare(password, admin.passwordHash);
            if (!isValidPassword) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            // Store admin in session
            req.session.adminUser = {
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role,
                isActive: admin.isActive
            };
            // Generate JWT token
            const token = jwt.sign({
                adminId: admin.id,
                email: admin.email,
                role: admin.role
            }, JWT_SECRET, { expiresIn: "7d" });
            res.json({
                token,
                admin: {
                    id: admin.id,
                    email: admin.email,
                    firstName: admin.firstName,
                    lastName: admin.lastName,
                    role: admin.role
                }
            });
        }
        catch (error) {
            console.error("Admin login error:", error);
            res.status(500).json({ message: "Failed to login" });
        }
    });
    // Admin logout route
    app.post('/api/admin/logout', async (req, res) => {
        try {
            // Clear admin session
            if (req.session) {
                req.session.adminUser = null;
                req.session.destroy((err) => {
                    if (err) {
                        console.error("Session destroy error:", err);
                    }
                });
            }
            res.json({ message: "Logged out successfully" });
        }
        catch (error) {
            console.error("Admin logout error:", error);
            res.status(500).json({ message: "Failed to logout" });
        }
    });
    // Enhanced middleware for protected admin routes (session + JWT)
    const requireAdminAuth = async (req, res, next) => {
        var _a;
        try {
            // First check session
            const sessionAdmin = (_a = req.session) === null || _a === void 0 ? void 0 : _a.adminUser;
            if (sessionAdmin && sessionAdmin.isActive) {
                req.admin = sessionAdmin;
                return next();
            }
            // Fallback to JWT token
            const authHeader = req.headers.authorization;
            const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer ")) ? authHeader.slice(7) : null;
            if (!token) {
                return res.status(401).json({ message: "Admin authentication required" });
            }
            const payload = jwt.verify(token, JWT_SECRET);
            if (!payload || !payload.adminId) {
                return res.status(401).json({ message: "Invalid admin token" });
            }
            // Verify admin still exists and is active
            const admin = await storage.getAdminUserById(payload.adminId);
            if (!admin || !admin.isActive) {
                return res.status(401).json({ message: "Admin account not found or inactive" });
            }
            // Update session with current admin info
            req.session.adminUser = {
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role,
                isActive: admin.isActive
            };
            req.admin = admin;
            next();
        }
        catch (error) {
            console.error("Admin auth error:", error);
            res.status(401).json({ message: "Invalid admin token" });
        }
    };
    // Admin user info endpoint
    app.get('/api/auth/user', async (req, res) => {
        var _a;
        try {
            const sessionAdmin = (_a = req.session) === null || _a === void 0 ? void 0 : _a.adminUser;
            if (sessionAdmin && sessionAdmin.isActive) {
                return res.json(sessionAdmin);
            }
            // Check JWT token if no session
            const authHeader = req.headers.authorization;
            const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer ")) ? authHeader.slice(7) : null;
            if (!token) {
                return res.status(401).json({ message: "Not authenticated" });
            }
            const payload = jwt.verify(token, JWT_SECRET);
            if (!payload || !payload.adminId) {
                return res.status(401).json({ message: "Invalid token" });
            }
            // Get admin from database
            const admin = await storage.getAdminUserById(payload.adminId);
            if (!admin || !admin.isActive) {
                return res.status(401).json({ message: "Admin not found or inactive" });
            }
            // Update session
            req.session.adminUser = {
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role,
                isActive: admin.isActive
            };
            res.json({
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role,
                isActive: admin.isActive
            });
        }
        catch (error) {
            console.error("Auth user error:", error);
            res.status(401).json({ message: "Authentication failed" });
        }
    });
    return requireAdminAuth;
}
