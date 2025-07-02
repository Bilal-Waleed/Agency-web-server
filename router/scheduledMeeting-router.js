import express from 'express';
import {
  createScheduledMeeting,
  getScheduledMeetings,
  acceptMeeting,
  rescheduleMeeting,
} from '../controllers/scheduledMeetingController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', authMiddleware, createScheduledMeeting);
router.get('/', authMiddleware, getScheduledMeetings);
router.put('/:id/accept', authMiddleware, acceptMeeting);
router.put('/:id/reschedule', authMiddleware, rescheduleMeeting);

export default router;