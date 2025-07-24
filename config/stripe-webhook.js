import express from 'express';
import Stripe from 'stripe';
import { finalizeOrder } from '../controllers/order-controllers.js';
import TempFile from '../models/tempFileModel.js';
import jwt from 'jsonwebtoken';
import { retryOperation } from '../utils/cloudinary.js';
import { completeOrderProcessing } from '../utils/order.js';
import cloudinary from '../config/cloudinary.js';
import User from '../models/userModel.js';
import Order from '../models/orderModel.js';

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
      const { userId, orderData, tempId, orderId, fileMeta, message, folderPath } = session.metadata;

      if (orderData && tempId) {
        const existingOrder = await Order.findOne({ 'sessionId': session.id }); 
        if (existingOrder) {
          console.log(`Order for session ${session.id} already processed, skipping`);
          return res.status(200).json({ received: true });
        }

        const reqMock = {
          body: { sessionId: session.id },
          headers: { authorization: `Bearer ${await generateToken(userId)}` },
          app: req.app,
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
        const order = await Order.findById(orderId);
        if (order && order.status === 'completed') {
          console.log(`Order ${orderId} already completed, skipping processing`);
          return res.status(200).json({ received: true });
        }

        try {
          await completeOrderProcessing(orderId, fileMeta, message, req.app.get('io'), folderPath);
          console.log(`Order ${orderId} processed successfully`);
        } catch (error) {
          console.error(`Failed to process order ${orderId}:`, error.message);
          return res.status(500).send('Failed to process order');
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
            await retryOperation(() => cloudinary.api.delete_folder(tempFile.tempFolder));
            console.log(`Deleted temporary folder from Cloudinary: ${tempFile.tempFolder}`);
          } catch (error) {
            console.error(`Failed to delete folder ${tempFile.tempFolder}:`, error.message);
          }
          await TempFile.findByIdAndDelete(tempId);
          console.log(`Deleted temporary file record: ${tempId}`);
        }
      }
    }

    res.status(200).json({ received: true });
  }
);

const generateToken = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return jwt.sign({ userID: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

export default router;