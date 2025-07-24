import cron from 'node-cron';
import { sendMeetingReminders } from '../controllers/scheduledMeetingController.js';
import TempFile from '../models/tempFileModel.js';
import cloudinary from '../config/cloudinary.js';
import { retryOperation } from '../utils/cloudinary.js';

export const startCronJob = (io) => {
  cron.schedule('*/10 * * * *', async () => {
    console.log('Checking for upcoming meetings...');
    try {
      const count = await sendMeetingReminders();
      console.log(`Processed ${count} meeting reminders`);
    } catch (error) {
      console.error('Error processing meeting reminders:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Karachi',
  });

  cron.schedule('*/10 * * * *', async () => {
    console.log('Checking for expired temporary files...');
    try {
      const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredFiles = await TempFile.find({
        createdAt: { $lte: threshold }, 
      });

      for (const tempFile of expiredFiles) {
        for (const file of tempFile.files) {
          try {
            await retryOperation(() =>
              cloudinary.uploader.destroy(file.public_id, { resource_type: file.resource_type || 'auto' })
            );
            console.log(`Deleted temporary file from Cloudinary: ${file.public_id}`);
          } catch (error) {
            console.error(`Failed to delete temporary file ${file.public_id}:`, error.message);
          }
        }
        try {
          await retryOperation(() => cloudinary.api.delete_folder(tempFile.tempFolder));
          console.log(`Deleted temporary folder from Cloudinary: ${tempFile.tempFolder}`);
        } catch (error) {
          console.error(`Failed to delete folder ${tempFile.tempFolder}:`, error.message);
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