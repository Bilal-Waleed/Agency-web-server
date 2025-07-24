import express from 'express';
import { orderForm, getUserOrders, createCheckoutSession, finalizeOrder, checkSession } from '../controllers/order-controllers.js';
import { getUserCancelRequests } from '../controllers/cancel-request-controller.js';
import multer from 'multer';
import authMiddleware from '../middleware/authMiddleware.js';
import { upload } from '../config/multer.js';

const router = express.Router();

router.post('/', authMiddleware, upload.array('files'), orderForm);
router.post('/finalize', authMiddleware, finalizeOrder);
router.get('/user', authMiddleware, getUserOrders);
router.get('/user-cancel-requests', authMiddleware, getUserCancelRequests);
router.post('/create-checkout-session', authMiddleware, createCheckoutSession);
router.get('/check-session/:sessionId', checkSession);

export default router;