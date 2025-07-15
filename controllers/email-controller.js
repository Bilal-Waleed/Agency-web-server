import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  secure: true,
  auth: {
    user: `${process.env.EMAIL_USER}`,
    pass: `${process.env.EMAIL_PASS}`,
  },
  logger: false,
  debug: false,
});

// Google Calendar API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });


const generateGoogleMeetLink = async (meetingDetails) => {
  try {
    const event = {
      summary: `Meeting with ${meetingDetails.userName} - Bold-Zyt Digital Solutions`,
      description: `Service: ${meetingDetails.serviceTitle}\nScheduled meeting with ${meetingDetails.userName}`,
      start: {
        dateTime: new Date(`${meetingDetails.date}T${meetingDetails.time}`).toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: new Date(new Date(`${meetingDetails.date}T${meetingDetails.time}`).getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: 'UTC',
      },
      conferenceData: {
        createRequest: {
          requestId: `meet-${meetingDetails._id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      attendees: [
        { email: meetingDetails.userEmail },
        { email: process.env.EMAIL_USER },
      ],
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });

    return response.data.hangoutLink;
  } catch (error) {
    console.error('Error generating Google Meet link:', error.message);
    throw error;
  }
};

const sendContactEmail = async (email, name) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Thank You for Contacting Us!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>Thank you for reaching out to our Bold-Zyt Digital Solutions agency. We have received your message.</p>
        <p>Our team is currently reviewing your inquiry, and we will get back to you as soon as possible with a detailed response. We are committed to delivering high-quality solutions tailored to your needs.</p>
        <p>In the meantime, feel free to explore our portfolio or contact us for any urgent queries.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOrderConfirmationEmail = async (email, name, orderDetails) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Order Confirmation - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>Thank you for placing an order with our Bold-Zyt Digital Solutions agency. We are excited to work on your project!</p>
        <p><strong>Order ID:</strong> ${orderDetails.orderId}</p>
        <p><strong>Order Details:</strong></p>
        <ul>
          <li>Order Type: ${orderDetails.projectType || 'N/A'}</li>
          <li>File: ${orderDetails.files || 'No file uploaded'}</li>
        </ul>
        <p>Our team will review your requirements and project details. Based on your specifications, we will provide a detailed pricing quote and timeline. One of our representatives will contact you shortly to discuss the next steps.</p>
        <p><strong>Payment Terms:</strong> To confirm your order, we require an initial 50% payment. The remaining balance will be due upon project completion.</p>
        <p>We look forward to delivering a solution that exceeds your expectations.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendRegistrationEmail = async (email, name) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Welcome to Bold-Zyt Digital Solutions Agency!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Welcome, ${name}!</h2>
        <p>Thank you for registering with Your Digital Solutions Agency. We're thrilled to have you on board!</p>
        <p>Your account has been successfully created, and you can now access our services, place orders, and explore our portfolio of web development solutions.</p>
        <p>Please verify your email using the OTP sent in a separate email.</p>
        <p>If you have any questions or need assistance, our support team is here to help. Feel free to reach out at any time.</p>
        <p>We look forward to collaborating with you on your next project!</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOTPVerificationEmail = async (email, name, otp) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "OTP Verification - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>Thank you for registering with Bold-Zyt Digital Solutions. To complete your registration, please use the following OTP to verify your email address:</p>
        <h3 style="color: #007bff; font-size: 24px; text-align: center;">${otp}</h3>
        <p>This OTP is valid for 10 minutes. Please enter it on the verification page to activate your account.</p>
        <p>If you did not request this, please ignore this email.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendPasswordResetEmail = async (email, name, resetLink) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Password Reset Request",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Password Reset Request</h2>
        <p>Dear ${name},</p>
        <p>We received a request to reset your password. Please click the link below to reset your password:</p>
        <p><a href="${resetLink}" style="color: #007bff; text-decoration: none;">Reset Your Password</a></p>
        <p>This link will expire in 1 hour for security reasons. If you did not request a password reset, please ignore this email.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendScheduledMeetingEmail = async (adminEmail, adminName, userName, serviceTitle, date, time) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: adminEmail,
    subject: "New Meeting Scheduled - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${adminName},</h2>
        <p>A new meeting has been scheduled by ${userName} for the following service:</p>
        <p><strong>Service:</strong> ${serviceTitle}</p>
        <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p>Please review the meeting details in the admin panel and take appropriate action to accept or reschedule the meeting.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendMeetingAcceptedEmail = async (userEmail, userName, serviceTitle, date, time) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: userEmail,
    subject: "Meeting Confirmation - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${userName},</h2>
        <p>We are pleased to confirm your meeting for the following service:</p>
        <p><strong>Service:</strong> ${serviceTitle}</p>
        <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p>Our team looks forward to discussing your requirements. Please be prepared for the meeting at the scheduled time.</p>
        <p>If you have any questions, feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendMeetingRescheduledEmail = async (userEmail, userName, serviceTitle, date, time) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: userEmail,
    subject: "Meeting Rescheduled - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${userName},</h2>
        <p>We regret to inform you that our team is unavailable at your requested meeting time. We have rescheduled your meeting for the following service:</p>
        <p><strong>Service:</strong> ${serviceTitle}</p>
        <p><strong>New Date:</strong> ${new Date(date).toLocaleDateString()}</p>
        <p><strong>New Time:</strong> ${time}</p>
        <p>Please confirm if the new schedule works for you. If you have any questions or need to discuss further, feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendCancelRequestAcceptedEmail = async (email, name, orderId) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Order Cancellation Request Accepted - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>We have reviewed your cancellation request for Order ID: ${orderId} and are pleased to inform you that it has been accepted.</p>
        <p>Your order has been successfully canceled, and any associated files have been removed from our system. If you have made any payments, our team will contact you regarding refund processing, if applicable.</p>
        <p>We value your feedback and hope to serve you again in the future. If you have any questions or need further assistance, please feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendCancelRequestDeclinedEmail = async (email, name, orderId) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Order Cancellation Request Declined - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>We have reviewed your cancellation request for Order ID: ${orderId}, and we regret to inform you that it has been declined.</p>
        <p>The reason for the decline is that more than 50% of the project work has been completed. As per our policy, cancellations are not permitted at this stage to ensure fairness and resource allocation.</p>
        <p>Our team will continue to work on your project to ensure timely delivery. If you have any concerns or need further clarification, please contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendAdminCancelOrderEmail = async (email, name, orderId, reason) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Order Cancelled by Admin - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>We regret to inform you that your order (Order ID: ${orderId}) has been cancelled by our administrative team.</p>
        <p><strong>Reason for Cancellation:</strong> ${reason}</p>
        <p>Any associated files have been removed from our system. If you have made any payments, our team will contact you regarding refund processing, if applicable.</p>
        <p>We apologize for any inconvenience caused and value your understanding. If you have any questions or need further assistance, please feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendOrderCompletedEmail = async (email, name, orderId, message, files) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: email,
    subject: "Order Completed - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${name},</h2>
        <p>We are pleased to inform you that your order (Order ID: ${orderId}) has been successfully completed!</p>
        ${message ? `<p><strong>Admin Message:</strong> ${message}</p>` : ''}
        <p>Please find the delivered files attached to this email. You can download and save them for your records.</p>
        <p>Thank you for choosing Bold-Zyt Digital Solutions. We hope you are satisfied with our services. If you have any feedback or need further assistance, please feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
    attachments: files.map((file) => ({
      filename: file.originalname,
      content: file.buffer,
    })),
  };

  await transporter.sendMail(mailOptions);
};

const sendMeetingReminderEmail = async (userEmail, userName, serviceTitle, date, time, meetLink) => {
  const mailOptions = {
    from: `${process.env.EMAIL_USER}`,
    to: userEmail,
    subject: "Meeting Reminder - Bold-Zyt Digital Solutions",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2c3e50;">Dear ${userName},</h2>
        <p>This is a reminder for your upcoming meeting with Bold-Zyt Digital Solutions:</p>
        <p><strong>Service:</strong> ${serviceTitle}</p>
        <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p><strong>Join Meeting:</strong> <a href="${meetLink}" style="color: #007bff; text-decoration: none;">Click here to join via Google Meet</a></p>
        <p>Please be prepared to discuss your requirements. If you have any questions, feel free to contact us.</p>
        <p>Best regards,</p>
        <p><strong>Bold-Zyt Digital Solutions Team</strong><br>
        Email: boldzyt.ds@gmail.com<br>
        Website: www.boldzytdigital.com</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

export {
  sendContactEmail,
  sendOrderConfirmationEmail,
  sendRegistrationEmail,
  sendOTPVerificationEmail,
  sendPasswordResetEmail,
  sendScheduledMeetingEmail,
  sendMeetingAcceptedEmail,
  sendMeetingRescheduledEmail,
  sendCancelRequestAcceptedEmail,
  sendCancelRequestDeclinedEmail,
  sendAdminCancelOrderEmail,
  sendOrderCompletedEmail,
  sendMeetingReminderEmail,
  generateGoogleMeetLink,
};