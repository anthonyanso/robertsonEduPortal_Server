const { storage } = require("./storage");
const { hashPassword, verifyPassword, generateJWT, adminAuthMiddleware, generateResetToken, verifyResetToken } = require("./adminAuth");
function registerAdminRoutes(app) {
    // Admin registration
    app.post('/api/admin/register', async (req, res) => {
        try {
            const { email, password, firstName, lastName } = req.body;
            if (!email || !password || !firstName || !lastName) {
                return res.status(400).json({ message: "All fields are required" });
            }
            // Check if admin already exists
            const [existingAdmin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
            if (existingAdmin) {
                return res.status(400).json({ message: "Admin with this email already exists" });
            }
            // Hash password and create admin
            const hashedPassword = await hashPassword(password);
            const newAdmin = {
                email,
                passwordHash: hashedPassword,
                firstName,
                lastName,
                role: "admin",
                isActive: true,
            };
            const [admin] = await db.insert(adminUsers).values(newAdmin).returning();
            res.status(201).json({
                message: "Admin registered successfully",
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
            console.error("Admin registration error:", error);
            res.status(500).json({ message: "Failed to register admin" });
        }
    });
    // Admin login
    app.post('/api/admin/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: "Email and password are required" });
            }
            // Find admin by email
            const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
            if (!admin || !admin.isActive) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            // Verify password
            const isValidPassword = await verifyPassword(password, admin.passwordHash);
            if (!isValidPassword) {
                return res.status(401).json({ message: "Invalid credentials" });
            }
            // Generate JWT token
            const token = generateJWT({
                adminId: admin.id,
                email: admin.email,
                role: admin.role
            });
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
    // Get current admin profile
    app.get('/api/admin/profile', adminAuthMiddleware, async (req, res) => {
        try {
            const admin = req.admin;
            res.json({
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role
            });
        }
        catch (error) {
            console.error("Get admin profile error:", error);
            res.status(500).json({ message: "Failed to get profile" });
        }
    });
    // Forgot password
    app.post('/api/admin/forgot-password', async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({ message: "Email is required" });
            }
            // Find admin by email
            const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
            if (!admin || !admin.isActive) {
                // Don't reveal if email exists for security
                return res.json({ message: "If the email exists, a reset link has been sent" });
            }
            // Generate reset token
            const resetToken = generateResetToken();
            const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
            // Update admin with reset token
            await db.update(admins)
                .set({
                resetToken,
                resetTokenExpiry,
                updatedAt: new Date()
            })
                .where(eq(admins.id, admin.id));
            // TODO: Send email with reset link
            // For now, we'll just log it (in production, integrate with email service)
            console.log(`Password reset token for ${email}: ${resetToken}`);
            res.json({ message: "If the email exists, a reset link has been sent" });
        }
        catch (error) {
            console.error("Forgot password error:", error);
            res.status(500).json({ message: "Failed to process password reset" });
        }
    });
    // Reset password
    app.post('/api/admin/reset-password', async (req, res) => {
        try {
            const { token, newPassword } = req.body;
            if (!token || !newPassword) {
                return res.status(400).json({ message: "Token and new password are required" });
            }
            // Verify reset token
            if (!verifyResetToken(token)) {
                return res.status(400).json({ message: "Invalid or expired reset token" });
            }
            // Find admin with this reset token
            const [admin] = await db.select().from(admins).where(eq(admins.resetToken, token));
            if (!admin || !admin.resetTokenExpiry || admin.resetTokenExpiry < new Date()) {
                return res.status(400).json({ message: "Invalid or expired reset token" });
            }
            // Hash new password and update admin
            const hashedPassword = await hashPassword(newPassword);
            await db.update(admins)
                .set({
                password: hashedPassword,
                resetToken: null,
                resetTokenExpiry: null,
                updatedAt: new Date()
            })
                .where(eq(admins.id, admin.id));
            res.json({ message: "Password reset successfully" });
        }
        catch (error) {
            console.error("Reset password error:", error);
            res.status(500).json({ message: "Failed to reset password" });
        }
    });
    // Logout (client-side token removal, but we can blacklist tokens if needed)
    app.post('/api/admin/logout', adminAuthMiddleware, async (req, res) => {
        try {
            // In a more complex system, we might blacklist the token here
            res.json({ message: "Logged out successfully" });
        }
        catch (error) {
            console.error("Admin logout error:", error);
            res.status(500).json({ message: "Failed to logout" });
        }
    });
}
module.exports = { registerAdminRoutes };
