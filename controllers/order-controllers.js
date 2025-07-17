import Order from "../models/orderModel.js";
import orderSchema from "../validators/order-schema.js";
import jwt from 'jsonwebtoken';
import { sendOrderConfirmationEmail } from "./email-controller.js";
import User from "../models/userModel.js";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const generateOrderId = async () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numLetters = Math.random() < 0.5 ? 2 : 3;
  let orderId;
  let isUnique = false;

  while (!isUnique) {
    const randomLetters = Array.from({ length: numLetters }, () =>
      letters[Math.floor(Math.random() * letters.length)]).join('');
    const randomDigits = Math.floor(1000 + Math.random() * 9000).toString();
    orderId = `${randomLetters}${randomDigits}`;
    const existingOrder = await Order.findOne({ orderId });
    if (!existingOrder) {
      isUnique = true;
    }
  }
  return orderId;
};

const uploadToCloudinary = (fileBuffer, folderName, mimetype) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        return resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    Readable.from(fileBuffer).pipe(uploadStream);
  });
};

const calculateHalfPayment = (budget) => {
  if (!budget) return 0;
  const [min, max] = budget.replace(/\$/g, '').split('-').map((val) => parseFloat(val) || 0);
  if (budget.includes('+')) return 2500;
  return ((min + (max || min)) / 2) * 0.5;
};

const createCheckoutSession = async (req, res) => {
  try {
    const { amount, orderData } = req.body;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).send({ error: 'Authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userID).select('name email avatar');
    if (!user) return res.status(404).send({ error: 'User not found' });

    const validationResult = orderSchema.safeParse(orderData);
    if (!validationResult.success) {
      return res.status(400).send({
        error: 'Invalid order form data',
        details: validationResult.error.errors,
      });
    }

    const parsedAmount = typeof amount === 'string'
      ? parseFloat(amount.replace('$', '')) * 100
      : amount;
    if (isNaN(parsedAmount)) {
      return res.status(400).send({ error: 'Invalid amount format' });
    }

    const expectedAmount = Math.round(calculateHalfPayment(orderData.projectBudget) * 100);
    if (parsedAmount !== expectedAmount) {
      return res.status(400).send({
        error: 'Payment amount does not match 50% of the project budget',
        details: {
          providedAmount: parsedAmount / 100,
          expectedAmount: expectedAmount / 100,
          projectBudget: orderData.projectBudget,
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Half Payment for Order - ${orderData.projectType}`,
            },
            unit_amount: parsedAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/order`,
      metadata: {
        userId: decoded.userID,
        orderData: JSON.stringify(orderData),
      },
    });

    res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).send({ error: 'Failed to create checkout session', details: error.message });
  }
};

const orderForm = async (req, res) => {
  try {
    const { sessionId, orderData } = req.body;
    const files = req.files || [];

    console.log('Received files:', files.map(f => ({ name: f.originalname, size: f.size, mimetype: f.mimetype })));

    if (!sessionId) {
      return res.status(400).send({ error: 'Session ID is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).send({ error: 'Payment not completed' });
    }

    const { userId, orderData: orderDataString } = session.metadata;
    if (!userId || !orderDataString) {
      return res.status(400).send({ error: 'Invalid session metadata' });
    }

    let parsedOrderData;
    try {
      parsedOrderData = JSON.parse(orderData || orderDataString);
    } catch (error) {
      return res.status(400).send({ error: 'Invalid order data format', details: error.message });
    }

    const validationResult = orderSchema.safeParse(parsedOrderData);
    if (!validationResult.success) {
      return res.status(400).send({
        error: 'Invalid order form data',
        details: validationResult.error.errors,
      });
    }

    const formData = validationResult.data;
    const user = await User.findById(userId).select('name email avatar');
    if (!user) return res.status(404).send({ error: 'User not found' });

    const maxSingleFileSize = 25 * 1024 * 1024; 
    const maxTotalSize = 25 * 1024 * 1024;
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    if (totalSize > maxTotalSize || files.some(file => file.size > maxSingleFileSize)) {
      return res.status(400).send({ error: 'File size exceeds limit (25MB per file or total)' });
    }

    const orderId = await generateOrderId();
    const folderName = `orders/${user.name.replace(/\s+/g, '_')}_${orderId}`;
    const fileUploads = files.map(async (file) => {
      try {
        const result = await uploadToCloudinary(file.buffer, folderName, file.mimetype);
        console.log(`Uploaded ${file.originalname} to Cloudinary: ${result.url}`);
        return {
          name: file.originalname,
          url: result.url,
          type: file.mimetype,
          public_id: result.public_id,
        };
      } catch (error) {
        console.error(`Cloudinary upload failed for ${file.originalname}:`, error.message);
        return null;
      }
    });

    const fileMeta = (await Promise.all(fileUploads)).filter(Boolean);
    const fileNames = fileMeta.map((file) => file.name);

    const order = new Order({
      orderId,
      ...formData,
      files: fileMeta,
      user: userId,
      avatar: user.avatar || null,
      initialPayment: session.amount_total / 100,
    });

    await order.save();
    console.log('Order saved with files:', order.files);

    await sendOrderConfirmationEmail(user.email, user.name, {
      ...formData,
      files: fileNames.join(', ') || 'No files uploaded',
      orderId,
      initialPayment: session.amount_total / 100,
    });

    res.status(200).send({
      message: 'Order submitted successfully',
      orderId,
      data: {
        ...formData,
        fileNames,
      },
    });
  } catch (error) {
    console.error('Order submission failed:', error);
    return res.status(500).send({
      error: 'Order submission failed',
      details: error.message,
    });
  }
};

const getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    const orders = await Order.find({
      $or: [{ user: userId }, { email: userEmail }],
    })
      .select(
        'orderId name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url files.public_id createdAt avatar status initialPayment'
      )
      .sort({ createdAt: -1 })
      .lean();

    const enhancedOrders = orders.map((order) => ({
      ...order,
      filesList: order.files?.length > 0 ? order.files.map((f) => f.name).join(', ') : 'None',
    }));

    res.status(200).json({
      error: false,
      message: 'User orders fetched successfully',
      data: enhancedOrders,
    });
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ error: true, message: 'Failed to fetch user orders' });
  }
};

export { orderForm, getUserOrders, createCheckoutSession };