const { storage } = require("../storage");
// Generate a unique student ID with format: ROB-YYYYMMDD-XXXX
// Where ROB is school prefix, YYYYMMDD is date, XXXX is random alphanumeric
async function generateUniqueStudentId() {
    const schoolPrefix = "ROB";
    const currentDate = new Date();
    const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, "");
    let isUnique = false;
    let studentId = "";
    while (!isUnique) {
        // Generate 4 random alphanumeric characters
        const randomSuffix = generateRandomAlphanumeric(4);
        studentId = `${schoolPrefix}-${dateStr}-${randomSuffix}`;
        // Check if this ID already exists
        const existingStudent = await storage.getStudentByStudentId(studentId);
        if (!existingStudent) {
            isUnique = true;
        }
    }
    return studentId;
}
function generateRandomAlphanumeric(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
// Alternative format: Sequential with prefix
async function generateSequentialStudentId() {
    const schoolPrefix = "ST";
    const currentYear = new Date().getFullYear().toString();
    // Get the count of existing students to determine the next number
    const students = await storage.getStudents();
    const nextNumber = (students.length + 1).toString().padStart(4, '0');
    let isUnique = false;
    let studentId = "";
    let counter = parseInt(nextNumber);
    while (!isUnique) {
        studentId = `${schoolPrefix}${currentYear}${counter.toString().padStart(4, '0')}`;
        // Check if this ID already exists
        const existingStudent = await storage.getStudentByStudentId(studentId);
        if (!existingStudent) {
            isUnique = true;
        }
        else {
            counter++;
        }
    }
    return studentId;
}
module.exports = { generateUniqueStudentId, generateSequentialStudentId };
