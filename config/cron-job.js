import cron from 'node-cron';
import { sendMeetingReminders } from '../controllers/scheduledMeetingController.js';

export const startCronJob = (io) => {
  cron.schedule('*/10 * * * *', async () => {
    console.log('Checking for upcoming meetings...');
    const count = await sendMeetingReminders(io);
    console.log(`Processed ${count} meeting reminders`);
  }, {
    scheduled: true,
    timezone: 'Asia/Karachi',
  });
};