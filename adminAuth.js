const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { storage } = require("./storage");
const JWT_SECRET = process.env.SESSION_SECRET || "admin-secret-key";

const hashPassword = async (password) => {
    return await bcrypt.hash(password, 12);
};
const verifyPassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};
const generateJWT = (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};
const verifyJWT = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
};
const adminAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
            return res.status(401).json({ message: "Admin authentication required" });
        }
        const payload = verifyJWT(token);
        if (!payload) {
            return res.status(401).json({ message: "Invalid admin token" });
        }
        // Verify admin still exists and is active
        const admin = await storage.getAdminUserById(payload.adminId);
        if (!admin || !admin.is_active) {
            return res.status(401).json({ message: "Admin account not found or inactive" });
        }
        req.admin = admin;
        next();
    } catch (error) {
        console.error("Admin auth middleware error:", error);
        res.status(500).json({ message: "Admin authentication error" });
    }
};
const generateResetToken = () => {
    return jwt.sign({ type: "reset", timestamp: Date.now() }, JWT_SECRET, { expiresIn: "1h" });
};
const verifyResetToken = (token) => {
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return payload.type === "reset";
    } catch {
        return false;
    }
};
module.exports = {
    JWT_SECRET,
    hashPassword,
    verifyPassword,
    generateJWT,
    verifyJWT,
    adminAuthMiddleware,
    generateResetToken,
    verifyResetToken
};
