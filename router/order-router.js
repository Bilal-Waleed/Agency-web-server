import express from 'express';
import { orderForm, getUserOrders, createCheckoutSession } from '../controllers/order-controllers.js';
import { getUserCancelRequests } from '../controllers/cancel-request-controller.js';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post('/', authMiddleware, upload.array('files'), orderForm);
router.get('/user', authMiddleware, getUserOrders);
router.get('/user-cancel-requests', authMiddleware, getUserCancelRequests);
router.post('/create-checkout-session', authMiddleware, createCheckoutSession);

export default router;