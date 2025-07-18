import express from 'express';
import Stripe from 'stripe';
import { finalizeOrder } from '../controllers/order-controllers.js';
import { sendOrderCompletedEmail } from '../controllers/email-controller.js';
import Order from '../models/orderModel.js';
import User from '../models/userModel.js';
import TempFile from '../models/tempFileModel.js';
import jwt from 'jsonwebtoken';
import cloudinary from '../config/cloudinary.js';
import mongoose from 'mongoose';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Retry operation helper
const retryOperation = async (operation, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`⚠️ Attempt ${attempt} failed: ${error.message}. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { userId, orderData, tempId, orderId, fileMeta, message } = session.metadata;

      if (orderData && tempId) {
        // Initial payment for order submission
        const reqMock = {
          body: { sessionId: session.id },
          headers: { authorization: `Bearer ${await generateToken(userId)}` },
        };
        const resMock = {
          status: (code) => ({
            send: (data) => console.log(`Order response: ${JSON.stringify(data)}`),
            json: (data) => console.log(`Order response: ${JSON.stringify(data)}`),
          }),
        };
        try {
          await finalizeOrder(reqMock, resMock);
          console.log(`Initial order finalized for session ${session.id}`);
        } catch (error) {
          console.error(`Failed to finalize initial order for session ${session.id}:`, error.message);
        }
      } else if (orderId && fileMeta) {
        // Remaining payment for order completion
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
          console.error('Invalid order ID:', orderId);
          return res.status(400).send('Invalid order ID');
        }

        const order = await Order.findById(orderId).populate('user');
        if (!order) {
          console.error('Order not found:', orderId);
          return res.status(404).send('Order not found');
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
          console.error('Failed to parse fileMeta:', error.message);
          return res.status(400).send('Invalid file metadata');
        }

        // Update order status
        try {
          await Order.findByIdAndUpdate(orderId, {
            status: 'completed',
            paymentStatus: 'full_paid',
            remainingPaymentSessionId: null,
          });
          console.log(`Order ${order.orderId} updated to completed`);
        } catch (error) {
          console.error(`Failed to update order ${orderId}:`, error.message);
          return res.status(500).send('Failed to update order');
        }

        // Send completion email
        try {
          await retryOperation(() =>
            sendOrderCompletedEmail(userEmail, userName, order.orderId, message, parsedFileMeta)
          );
          console.log(`Order completion email sent to ${userEmail} for order ${order.orderId}`);
        } catch (emailError) {
          console.error(`Failed to send order completion email for order ${order.orderId}:`, emailError.message);
        }

        // Delete files and folder from Cloudinary
        try {
          for (const file of parsedFileMeta) {
            if (file.public_id) {
              await retryOperation(() =>
                cloudinary.uploader.destroy(file.public_id, {
                  resource_type: file.resource_type || 'auto',
                })
              );
              console.log(`Deleted file from Cloudinary: ${file.public_id}`);
            }
          }

          // Extract timestamp from public_id to construct folder path
          const timestamp = parsedFileMeta[0]?.public_id.split('_').slice(-1)[0];
          if (timestamp) {
            const folderPath = `completed_orders/${order.orderId}_${timestamp}`;
            await retryOperation(() => cloudinary.api.delete_folder(folderPath));
            console.log(`Deleted folder from Cloudinary: ${folderPath}`);
          } else {
            console.warn(`No timestamp found in public_id for order ${order.orderId}. Skipping folder deletion.`);
          }
        } catch (cloudinaryError) {
          console.error(`Failed to delete files or folder from Cloudinary for order ${order.orderId}:`, cloudinaryError.message);
        }

        // Emit Socket.IO event for real-time notification
        try {
          const io = req.app.get('io');
          io.to('adminRoom').emit('orderCompleted', { orderId: order.orderId });
          console.log(`Emitted orderCompleted event for order ${order.orderId}`);
        } catch (socketError) {
          console.error(`Failed to emit Socket.IO event for order ${order.orderId}:`, socketError.message);
        }
      } else {
        console.error('Invalid metadata for checkout.session.completed:', session.metadata);
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const { tempId } = session.metadata;
      if (tempId) {
        const tempFile = await TempFile.findById(tempId);
        if (tempFile) {
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
            await TempFile.findByIdAndDelete(tempId);
            console.log(`Deleted temporary file record: ${tempId}`);
          } catch (error) {
            console.error(`Failed to delete TempFile ${tempId}:`, error.message);
          }
        }
      }
    }

    res.status(200).json({ received: true });
  }
);

const generateToken = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return jwt.sign({ userID: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

export default router;