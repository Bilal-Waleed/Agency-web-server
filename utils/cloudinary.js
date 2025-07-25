import cloudinary from '../config/cloudinary.js';
import { Readable } from 'stream';

export const retryOperation = async (operation, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export const uploadToCloudinary = (fileBuffer, folderName, mimetype, fileName) => {
  return new Promise((resolve, reject) => {
    const getResourceType = (mime) => {
      if (mime.startsWith('image/')) return 'image';
      if (
        mime === 'application/pdf' ||
        mime === 'application/zip' ||
        mime === 'application/x-zip-compressed' ||
        mime === 'application/msword' ||
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) return 'raw';
      if (mime.startsWith('video/')) return 'video';
      return 'raw';
    };

    const resource_type = getResourceType(mimetype);
    const safeFileName = fileName.replace(/\.+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const public_id = `${folderName}/${safeFileName.split('.').slice(0, -1).join('.')}`;

    console.log(`Uploading to Cloudinary: ${public_id} [${resource_type}]`);

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderName, public_id, resource_type, timeout: 120000 },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error details:', JSON.stringify(error, null, 2));
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        cloudinary.api.resource(result.public_id, { resource_type })
          .then(() => resolve({ url: result.secure_url, public_id: result.public_id, resource_type }))
          .catch(err => {
            console.error(`Failed to verify uploaded file ${result.public_id}:`, err.message);
            reject(err);
          });
      }
    );
    Readable.from(fileBuffer).pipe(uploadStream);
  });
};