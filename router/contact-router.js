import express from 'express';
import contactForm from '../controllers/contact-controllers.js';

const router = express.Router();

router.post('/', contactForm);

export default router;