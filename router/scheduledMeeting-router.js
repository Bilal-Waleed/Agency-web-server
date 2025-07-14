import express from 'express';
import {
  createScheduledMeeting,
  getScheduledMeetings,
  acceptMeeting,
  rescheduleMeeting,
} from '../controllers/scheduledMeetingController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import isAdminMiddleware from '../middleware/isAdminMiddleware.js';

const router = express.Router();

router.post('/', authMiddleware, createScheduledMeeting);
router.get('/', authMiddleware, getScheduledMeetings);
router.put('/:id/accept', isAdminMiddleware, acceptMeeting);
router.put('/:id/reschedule', isAdminMiddleware, rescheduleMeeting);

export default router;