import express from 'express';
import Stripe from 'stripe';
import { finalizeOrder } from '../controllers/order-controllers.js';
import { sendOrderCompletedEmail } from '../controllers/email-controller.js';
import Order from '../models/orderModel.js';
import User from '../models/userModel.js';
import TempFile from '../models/tempFileModel.js';
import jwt from 'jsonwebtoken';
import cloudinary from '../config/cloudinary.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      const { userId, orderData, tempId } = session.metadata;

      if (orderData && tempId) {
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
        await finalizeOrder(reqMock, resMock);
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const { tempId } = session.metadata;
      if (tempId) {
        const tempFile = await TempFile.findById(tempId);
        if (tempFile) {
          for (const file of tempFile.files) {
            try {
              await cloudinary.uploader.destroy(file.public_id, { resource_type: 'auto' });
              console.log(`Deleted temporary file from Cloudinary: ${file.public_id}`);
            } catch (error) {
              console.error(`Failed to delete temporary file ${file.public_id}:`, error.message);
            }
          }
          await TempFile.findByIdAndDelete(tempId);
          console.log(`Deleted temporary file record: ${tempId}`);
        }
      }
    } else if (event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const { orderId, userId, fileMeta, message } = session.metadata;

      if (orderId) {
        const order = await Order.findById(orderId).populate('user');
        if (!order) {
          console.error('Order not found:', orderId);
          return res.status(404).send('Order not found');
        }

        let user = order.user;
        if (!user && order.email) {
          user = await User.findOne({ email: order.email });
        }

        const userName = user?.name || order.name;
        const userEmail = user?.email || order.email;
        const parsedFileMeta = JSON.parse(fileMeta || '[]');

        await Order.findByIdAndUpdate(orderId, { status: 'completed', paymentStatus: 'full_paid' });

        await sendOrderCompletedEmail(userEmail, userName, order.orderId, message, parsedFileMeta);

        for (const file of parsedFileMeta) {
          if (file.public_id) {
            try {
              await cloudinary.uploader.destroy(file.public_id, { resource_type: 'auto' });
              console.log(`Deleted file from Cloudinary: ${file.public_id}`);
            } catch (error) {
              console.error(`Failed to delete file from Cloudinary: ${file.public_id}:`, error);
            }
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