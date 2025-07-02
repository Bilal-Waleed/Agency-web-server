import express from 'express';
import orderForm from '../controllers/order-controllers.js';
import multer from 'multer';
import isAdminMiddleware from '../middleware/isAdminMiddleware.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post('/', isAdminMiddleware, upload.array('files'), orderForm);

export default router;