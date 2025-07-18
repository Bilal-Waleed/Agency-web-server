import Order from '../models/orderModel.js';
import User from '../models/userModel.js';
import { sendOrderCompletedEmail } from '../controllers/email-controller.js';
import { retryOperation } from './cloudinary.js';
import cloudinary from '../config/cloudinary.js';
import mongoose from 'mongoose';

export const completeOrderProcessing = async (orderId, fileMeta, message, io, folderPath) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new Error('Invalid order ID');
  }

  const order = await Order.findById(orderId).populate('user');
  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status === 'completed') {
    console.log(`ℹ️ Order ${order.orderId} already completed`);
    return;
  }

  let user = order.user;
  if (!user && order.email) {
    user = await User.findOne({ email: order.email });
    if (!user) {
      console.warn('User not found for email:', order.email);
    }
  }

  const userName = user?.name || order.name;
  const userEmail = user?.email || order.email;

  let parsedFileMeta;
  try {
    parsedFileMeta = JSON.parse(fileMeta || '[]');
    if (!Array.isArray(parsedFileMeta)) {
      throw new Error('Invalid file metadata format');
    }
  } catch (error) {
    throw new Error(`Invalid file metadata: ${error.message}`);
  }

  try {
    await Order.findByIdAndUpdate(orderId, {
      status: 'completed',
      paymentStatus: 'full_paid',
      remainingPaymentSessionId: null,
    });
    console.log(`✅ Order ${order.orderId} updated to completed`);

    await retryOperation(() =>
      sendOrderCompletedEmail(userEmail, userName, order.orderId, message, parsedFileMeta)
    );
    console.log(`✅ Email sent to ${userEmail} for order ${order.orderId}`);

    for (const file of parsedFileMeta) {
      if (file.public_id) {
        await retryOperation(() =>
          cloudinary.uploader.destroy(file.public_id, { resource_type: file.resource_type || 'auto' })
        );
        console.log(`✅ Deleted file from Cloudinary: ${file.public_id}`);
      }
    }

    if (folderPath || parsedFileMeta[0]?.public_id) {
      const folder = folderPath || parsedFileMeta[0]?.public_id?.substring(0, parsedFileMeta[0].public_id.lastIndexOf('/'));
      if (folder) {
        await retryOperation(() => cloudinary.api.delete_folder(folder));
        console.log(`✅ Deleted folder from Cloudinary: ${folder}`);
      }
    }

    if (io) {
      io.to('adminRoom').emit('orderCompleted', { orderId: order.orderId });
      console.log(`✅ Emitted orderCompleted event for ${order.orderId}`);
    }
  } catch (error) {
    console.error(`❌ Error in completeOrderProcessing for order ${orderId}:`, error.message, error);
    throw new Error(`Failed to complete order processing: ${error.message}`);
  }
};