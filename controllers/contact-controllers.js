import Contact from "../models/contactModel.js";
import contactSchema from "../validators/contact-schema.js";
import { sendContactEmail } from "./email-controller.js";
import User from "../models/userModel.js"; 

const contactForm = async (req, res) => {
  const response = contactSchema.safeParse(req.body);
  if (!response.success) {
    return res.status(400).send({ error: 'Invalid contact form data' });
  }

  try {
    const user = await User.findOne({ email: response.data.email });

    const contactData = {
      ...response.data,
      avatar: user?.avatar || ""
    };

    const contact = new Contact(contactData);
    await contact.save();

    res.status(200).send({
      message: 'Contact form submitted successfully',
      data: contact
    });

    sendContactEmail(response.data.email, response.data.name)
      .catch((emailError) => {
        console.error('Email sending failed:', emailError.message);
      });

  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).send({ error: 'Contact form submission failed' });
  }
};

export default contactForm;
