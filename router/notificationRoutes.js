import express from 'express';
import { getNotifications, markNotificationsViewed } from '../controllers/notificationController.js';
import isAdminMiddleware from '../middleware/isAdminMiddleware.js';

const router = express.Router();

router.get('/', isAdminMiddleware, getNotifications);
router.post('/mark-viewed',isAdminMiddleware, markNotificationsViewed);

export default router;