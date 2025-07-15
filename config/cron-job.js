import cron from 'node-cron';
import { sendMeetingReminders } from '../controllers/scheduledMeetingController.js';

export const startCronJob = (io) => {
  cron.schedule('*/5 * * * *', async () => {
    console.log('Checking for upcoming meetings...');
    await sendMeetingReminders(io);
  });
};
