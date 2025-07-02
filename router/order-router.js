import express from 'express';
import {orderForm, getUserOrders }from '../controllers/order-controllers.js';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post('/', authMiddleware, upload.array('files'), orderForm);
router.get('/user', authMiddleware, getUserOrders);

export default router;