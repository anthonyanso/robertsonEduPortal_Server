
const { query } = require("./db");
const bcrypt = require("bcryptjs");

const storage = {
    // Admin user operations
    async getAdminUserByEmail(email) {
        const result = await query("SELECT * FROM admin_users WHERE email = $1 LIMIT 1", [email]);
        return result.rows[0];
    },
    async createAdminUser(adminUserData) {
        const result = await query(
            `INSERT INTO admin_users (email, first_name, last_name, password_hash, role, is_active)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [adminUserData.email, adminUserData.firstName, adminUserData.lastName, adminUserData.passwordHash, adminUserData.role, adminUserData.isActive]
        );
        return result.rows[0];
    },
    // Student operations
    async getStudents() {
        const result = await query("SELECT * FROM students ORDER BY created_at DESC");
        return result.rows;
    },
    async getStudent(id) {
        const result = await query("SELECT * FROM students WHERE id = $1 LIMIT 1", [id]);
        return result.rows[0];
    },
    async getStudentByStudentId(studentId) {
        const result = await query("SELECT * FROM students WHERE student_id = $1 LIMIT 1", [studentId]);
        return result.rows[0];
    },
    async createStudent(student) {
        const result = await query(
            `INSERT INTO students (student_id, first_name, last_name, email, phone, date_of_birth, gender, nationality, address, grade_level, father_name, mother_name, guardian_phone, guardian_email, medical_conditions, special_needs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [student.studentId, student.firstName, student.lastName, student.email, student.phone, student.dateOfBirth, student.gender, student.nationality, student.address, student.gradeLevel, student.fatherName, student.motherName, student.guardianPhone, student.guardianEmail, student.medicalConditions, student.specialNeeds]
        );
        return result.rows[0];
    },
    async updateStudent(id, student) {
        // Build dynamic update query
        const fields = Object.keys(student);
        const values = Object.values(student);
        if (fields.length === 0) return null;
        const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
        const result = await query(
            `UPDATE students SET ${setClause}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`,
            [...values, id]
        );
        return result.rows[0];
    },
    async deleteStudent(id) {
        await query("DELETE FROM students WHERE id = $1", [id]);
    },
    // Add similar methods for results, scratch cards, news, admission applications, and school info as needed
};

module.exports = { storage };
