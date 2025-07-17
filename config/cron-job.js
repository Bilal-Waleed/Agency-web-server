import cron from 'node-cron';
import { sendMeetingReminders } from '../controllers/scheduledMeetingController.js';
import TempFile from '../models/tempFileModel.js';
import cloudinary from '../config/cloudinary.js';

export const startCronJob = (io) => {
  // Meeting reminders (existing)
  cron.schedule('*/10 * * * *', async () => {
    console.log('Checking for upcoming meetings...');
    const count = await sendMeetingReminders(io);
    console.log(`Processed ${count} meeting reminders`);
  }, {
    scheduled: true,
    timezone: 'Asia/Karachi',
  });

  // Cleanup temporary files
  cron.schedule('*/5 * * * *', async () => {
    console.log('Checking for expired temporary files...');
    try {
      const expiredFiles = await TempFile.find({
        expiresAt: { $lte: new Date() },
      });

      for (const tempFile of expiredFiles) {
        for (const file of tempFile.files) {
          try {
            await cloudinary.uploader.destroy(file.public_id, { resource_type: 'auto' });
            console.log(`Deleted temporary file from Cloudinary: ${file.public_id}`);
          } catch (error) {
            console.error(`Failed to delete temporary file ${file.public_id}:`, error.message);
          }
        }
        await TempFile.findByIdAndDelete(tempFile._id);
        console.log(`Deleted temporary file record: ${tempFile._id}`);
      }
      console.log(`Processed ${expiredFiles.length} expired temporary files`);
    } catch (error) {
      console.error('Error cleaning up temporary files:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Karachi',
  });
};