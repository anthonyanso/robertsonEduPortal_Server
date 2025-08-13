const nodemailer = require('nodemailer');
// SMTP configuration - using Gmail as default
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'robertsonvocational@gmail.com',
        pass: process.env.SMTP_PASS || 'Robertsoneducation123*',
    },
});
async function sendEmail(params) {
    if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
        console.warn("Cannot send email - SMTP_USER or EMAIL_USER not configured");
        return false;
    }
    try {
        await transporter.sendMail({
            from: params.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
            html: params.html,
        });
        console.log(`Email sent successfully to ${params.to}`);
        return true;
    } catch (error) {
        console.error('SMTP email error:', error);
        return false;
    }
}
async function sendContactFormEmail(formData) {
    const emailContent = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${formData.firstName} ${formData.lastName}</p>
    <p><strong>Email:</strong> ${formData.email}</p>
    ${formData.phone ? `<p><strong>Phone:</strong> ${formData.phone}</p>` : ''}
    <p><strong>Subject:</strong> ${formData.subject}</p>
    <p><strong>Message:</strong></p>
    <p>${formData.message.replace(/\n/g, '<br>')}</p>
  `;
    return await sendEmail({
        to: 'robertsonvocational@gmail.com',
        from: process.env.SMTP_USER || process.env.EMAIL_USER || 'robertsonvocational@gmail.com',
        subject: `Contact Form: ${formData.subject}`,
        html: emailContent,
        text: `
      New Contact Form Submission
      Name: ${formData.firstName} ${formData.lastName}
      Email: ${formData.email}
      ${formData.phone ? `Phone: ${formData.phone}` : ''}
      Subject: ${formData.subject}
      Message: ${formData.message}
    `
    });
}
module.exports = { sendEmail, sendContactFormEmail };
