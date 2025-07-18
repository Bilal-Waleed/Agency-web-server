import Order from "../models/orderModel.js";
import TempFile from "../models/tempFileModel.js"; 
import orderSchema from "../validators/order-schema.js";
import jwt from 'jsonwebtoken';
import { sendOrderConfirmationEmail, sendOrderCompletedEmail } from "./email-controller.js";
import User from "../models/userModel.js";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import Stripe from 'stripe';
import dotenv from 'dotenv';
import mongoose from "mongoose";
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

const uploadToCloudinary = (fileBuffer, folderName, mimetype, fileName) => {
  return new Promise((resolve, reject) => {
    const getResourceType = (mime) => {
      if (mime.startsWith('image/')) return 'image';
      if (mime === 'application/pdf' || 
          mime === 'application/zip' || 
          mime === 'application/x-zip-compressed' ||
          mime === 'application/msword' || 
          mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'raw';
      if (mime.startsWith('video/')) return 'video';
      return 'raw';
    };

    const resource_type = getResourceType(mimetype);
    const safeFileName = fileName.replace(/\.+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const public_id = `${folderName}/${safeFileName.split('.').slice(0, -1).join('.')}`; 

    console.log(`ℹ️ Uploading to Cloudinary: ${public_id} [${resource_type}]`);

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        public_id,
        resource_type,
        timeout: 120000,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error details:', JSON.stringify(error, null, 2));
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        cloudinary.api.resource(result.public_id, { resource_type })
          .then(() => resolve({
            url: result.secure_url,
            public_id: result.public_id,
            resource_type,
          }))
          .catch(err => {
            console.error(`❌ Failed to verify uploaded file ${result.public_id}:`, err.message);
            reject(err);
          });
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

const checkSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`ℹ️ Checking session ${sessionId}:`, session.status);

    if (session.status === 'complete' && session.payment_status === 'paid') {
      const { orderId, fileMeta, orderData, tempId, userId, message } = session.metadata;

      // Check if this is a remaining payment session
      if (orderId && fileMeta) {
        // Remaining payment session
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
          console.error('❌ Invalid order ID:', orderId);
          return res.status(400).json({ error: 'Invalid order ID', isRemainingPayment: true });
        }

        const order = await Order.findById(orderId).populate('user');
        if (!order) {
          console.error('❌ Order not found:', orderId);
          return res.status(404).json({ error: 'Order not found', isRemainingPayment: true });
        }
        console.log(`ℹ️ Order found: ${order.orderId}`);

        // Check if order is already completed
        if (order.status === 'completed') {
          console.log(`ℹ️ Order ${order.orderId} already completed`);
          return res.status(200).json({ success: true, isRemainingPayment: true });
        }

        let user = order.user;
        if (!user && order.email) {
          user = await User.findOne({ email: order.email });
          if (!user) {
            console.warn(`⚠️ User not found for email: ${order.email}. Using order details.`);
          }
        }

        const userName = user?.name || order.name;
        const userEmail = user?.email || order.email;
        console.log(`ℹ️ User details - Name: ${userName}, Email: ${userEmail}`);

        let parsedFileMeta;
        try {
          parsedFileMeta = JSON.parse(fileMeta || '[]');
          if (!Array.isArray(parsedFileMeta)) {
            throw new Error('Invalid file metadata format');
          }
          console.log(`ℹ️ Parsed fileMeta:`, JSON.stringify(parsedFileMeta, null, 2));
        } catch (error) {
          console.error('❌ Failed to parse fileMeta:', error.message);
          return res.status(400).json({ error: 'Invalid file metadata', isRemainingPayment: true });
        }
        try {
          await Order.findByIdAndUpdate(
            orderId,
            {
              status: 'completed',
              paymentStatus: 'full_paid',
              remainingPaymentSessionId: null,
            },
            { new: true }
          );
          console.log(`✅ Order ${order.orderId} updated to completed`);
        } catch (error) {
          console.error(`❌ Failed to update order ${order.orderId}:`, error.message);
          return res.status(500).json({ error: 'Failed to update order', isRemainingPayment: true });
        }

        try {
          await retryOperation(() =>
            sendOrderCompletedEmail(userEmail, userName, order.orderId, message, parsedFileMeta)
          );
          console.log(`✅ Order completion email sent to ${userEmail} for order ${order.orderId}`);
        } catch (emailError) {
          console.error(`❌ Failed to send order completion email for order ${order.orderId}:`, emailError.message);
        }
        try {
          for (const file of parsedFileMeta) {
            if (file.public_id) {
              await retryOperation(() =>
                cloudinary.uploader.destroy(file.public_id, {
                  resource_type: file.resource_type || 'auto',
                })
              );
              console.log(`✅ Deleted file from Cloudinary: ${file.public_id}`);
            } else {
              console.warn(`⚠️ No public_id for file: ${file.name}`);
            }
          }

          if (parsedFileMeta.length > 0 && parsedFileMeta[0].public_id) {
          const publicId = parsedFileMeta[0].public_id;
          console.log(`📂 Raw public_id: ${publicId}`);
          const matches = publicId.match(/(completed_orders\/[A-Z0-9_]+_\d+)/);
          const folderPath = matches ? matches[1] : publicId.substring(0, publicId.lastIndexOf('/'));
            try {
              const result = await retryOperation(() => cloudinary.api.delete_folder(folderPath));
              console.log(`✅ Deleted folder from Cloudinary: ${folderPath}`, result);
            } catch (folderError) {
              console.error(`❌ Failed to delete Cloudinary folder ${folderPath}:`, folderError.message || 'Unknown error');
            }
          } else {
            console.warn(`⚠️ No public_id found for order ${order.orderId}. Skipping folder deletion.`);
          }
        } catch (cloudinaryError) {
          console.error(`❌ Failed to delete files or folder from Cloudinary for order ${order.orderId}:`, cloudinaryError.message || 'Unknown error');
        }

        // Emit Socket.IO event
        try {
          const io = req.app.get('io');
          if (!io) {
            console.error('❌ Socket.IO server not initialized');
          } else {
            io.to('adminRoom').emit('orderCompleted', { orderId: order.orderId });
            console.log(`✅ Emitted orderCompleted event for order ${order.orderId}`);
          }
        } catch (socketError) {
          console.error(`❌ Failed to emit Socket.IO event for order ${order.orderId}:`, socketError.message);
        }

        return res.status(200).json({ success: true, isRemainingPayment: true });
      } else if (orderData && tempId && userId) {
        // Initial payment session
        return res.status(200).json({ success: true, isRemainingPayment: false });
      } else {
        console.error(`❌ Invalid session metadata:`, session.metadata);
        return res.status(400).json({ error: 'Invalid session metadata', isRemainingPayment: false });
      }
    } else {
      console.error(`❌ Session not completed or not paid: ${session.status}, ${session.payment_status}`);
      return res.status(400).json({ error: 'Payment not completed', isRemainingPayment: false });
    }
  } catch (error) {
    console.error(`❌ Error checking session ${sessionId}:`, error.message);
    return res.status(500).json({ error: 'Internal Server Error', isRemainingPayment: false });
  }
};

const createCheckoutSession = async (req, res) => {
  try {
    const { amount, orderData, tempId } = req.body; 
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
        tempId,
      },
    });

    res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error.message, error);
    res.status(500).send({ error: 'Failed to create checkout session', details: error.message });
  }
};

const orderForm = async (req, res) => {
  try {
    const { orderData } = req.body;
    const files = req.files || [];

    let parsedOrderData;
    try {
      parsedOrderData = JSON.parse(orderData);
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
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).send({ error: 'Authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userID).select('name email avatar');
    if (!user) return res.status(404).send({ error: 'User not found' });

    const maxSingleFileSize = 25 * 1024 * 1024; 
    const maxTotalSize = 25 * 1024 * 1024;
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    if (totalSize > maxTotalSize || files.some(file => file.size > maxSingleFileSize)) {
      return res.status(400).send({ error: 'File size exceeds limit (25MB per file or total)' });
    }

    console.log('ℹ️ Received files:', JSON.stringify(files.map(f => ({ name: f.originalname, mimetype: f.mimetype, size: f.size })), null, 2));

    const timestamp = Date.now();
    const tempFolder = `temp_orders/${user.name.replace(/\s+/g, '_')}_${timestamp}`;
    const fileUploads = files.map(async (file) => {
      if (file.mimetype === 'application/json') {
        console.warn(`❌ Skipping unsupported file type: ${file.originalname}`);
        return null;
      }

      try {
        const safeFileName = file.originalname.replace(/\.+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
        console.log(`ℹ️ Uploading file: ${safeFileName} (${file.size} bytes) to folder: ${tempFolder}`);
        const result = await retryOperation(() => 
          uploadToCloudinary(file.buffer, tempFolder, file.mimetype, safeFileName)
        );
        console.log(`✅ Uploaded file: ${safeFileName}, public_id: ${result.public_id}, url: ${result.url}`);

        return {
          name: file.originalname,
          url: result.url,
          type: file.mimetype,
          public_id: result.public_id,
          resource_type: result.resource_type,
        };
      } catch (error) {
        console.error(`Cloudinary upload failed for ${file.originalname}:`, error.message);
        return null;
      }
    });

    const fileMeta = (await Promise.all(fileUploads)).filter(Boolean);
    if (!fileMeta.length && files.length > 0) {
      console.warn('⚠️ No files were uploaded successfully to Cloudinary');
      return res.status(500).send({
        error: 'Failed to upload files to Cloudinary',
        details: 'All file uploads failed, possibly due to network issues or Cloudinary configuration. Please try again or contact support.',
      });
    }

    const tempFile = new TempFile({
      userId: decoded.userID,
      tempFolder,
      files: fileMeta,
    });
    console.log('ℹ️ Saving TempFile with metadata:', JSON.stringify(tempFile, null, 2));
    await tempFile.save();

    res.status(200).send({
      message: 'Order data and files temporarily saved',
      tempId: tempFile._id,
      paymentAmount: calculateHalfPayment(formData.projectBudget),
      fileNames: fileMeta.map(file => file.name),
    });
  } catch (error) {
    console.error('Order submission failed:', error.message, error);
    res.status(500).send({
      error: 'Order submission failed',
      details: error.message,
    });
  }
};

const finalizeOrder = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).send({ error: 'Session ID is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).send({ error: 'Payment not completed' });
    }

    const { userId, orderData, tempId } = session.metadata;
    if (!userId || !orderData || !tempId) {
      return res.status(400).send({ error: 'Invalid session metadata' });
    }

    const parsedOrderData = JSON.parse(orderData);
    const validationResult = orderSchema.safeParse(parsedOrderData);
    if (!validationResult.success) {
      return res.status(400).send({ error: 'Invalid order form data', details: validationResult.error.errors });
    }

    const formData = validationResult.data;
    const user = await User.findById(userId).select('name email avatar');
    if (!user) return res.status(404).send({ error: 'User not found' });

    const tempFile = await TempFile.findById(tempId);
    if (!tempFile) {
      return res.status(404).send({ error: 'Temporary file data not found' });
    }

    const orderId = await generateOrderId();
    const timestamp = Date.now();
    const permanentFolder = `orders/${user.name.replace(/\s+/g, '_')}_${timestamp}`;
    console.log('🗂️ permanentFolder:', permanentFolder);
    console.log('📁 Moving files from:', tempFile.tempFolder, '➜', permanentFolder);

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

    let fileMeta = [];
    let failedFiles = [];
    if (tempFile.files.length > 0) {
      fileMeta = await Promise.all(
        tempFile.files.map(async (file) => {
          try {
            const oldPublicId = file.public_id;
            const safeFileName = file.name.replace(/\.+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
            const newPublicId = `${permanentFolder}/${safeFileName.split('.').slice(0, -1).join('.')}`; // Remove extension for images

            console.log('📄 oldPublicId:', oldPublicId);
            console.log(`ℹ️ Using resource_type: ${file.resource_type || getResourceType(file.type)} for file ${file.name} (MIME: ${file.type})`);

            let resource;
            try {
              resource = await retryOperation(() =>
                cloudinary.api.resource(oldPublicId, {
                  resource_type: file.resource_type || getResourceType(file.type),
                  timeout: 120000,
                })
              );
              console.log(`✅ File ${oldPublicId} exists with resource_type: ${resource.resource_type}`);
            } catch (error) {
              console.error(`❌ File ${oldPublicId} does not exist in Cloudinary:`, error.message);
              failedFiles.push(file.name);
              return null;
            }

            const fileUrl = cloudinary.url(oldPublicId, {
              resource_type: resource.resource_type,
              secure: true,
            });
            console.log(`ℹ️ Fetching file content from: ${fileUrl}`);

            const response = await retryOperation(() =>
              fetch(fileUrl, { signal: AbortSignal.timeout(120000) })
            );
            if (!response.ok) {
              console.error(`❌ Failed to fetch file ${oldPublicId}: ${response.statusText}`);
              failedFiles.push(file.name);
              return null;
            }
            const fileBuffer = Buffer.from(await response.arrayBuffer());

            console.log(`🔄 Uploading file to: ${newPublicId} [${resource.resource_type}]`);
            const uploadResult = await retryOperation(() =>
              uploadToCloudinary(fileBuffer, permanentFolder, file.type, safeFileName)
            );

            console.log(`🗑️ Deleting original file: ${oldPublicId} [${resource.resource_type}]`);
            await retryOperation(() =>
              cloudinary.uploader.destroy(oldPublicId, { resource_type: resource.resource_type })
            );

            console.log(`✅ File transferred successfully: ${oldPublicId} -> ${newPublicId}`);

            return {
              name: file.name,
              url: uploadResult.url,
              type: file.type,
              public_id: uploadResult.public_id,
              resource_type: uploadResult.resource_type,
            };
          } catch (error) {
            console.error(`❌ Failed to transfer file ${file.name}:`, error.message);
            failedFiles.push(file.name);
            return null;
          }
        })
      ).then((results) => results.filter(Boolean));
    }

    const order = new Order({
      orderId,
      ...formData,
      files: fileMeta,
      user: userId,
      avatar: user.avatar || null,
      initialPayment: session.amount_total / 100,
      paymentStatus: 'half_paid',
      tempFolder: tempFile.tempFolder,
      permanentFolder,
    });

    await order.save();
    console.log(`✅ Order saved with ID: ${orderId}`);

    if (tempFile.files.length > 0 && fileMeta.length === tempFile.files.length) {
      try {
        const resourceTypes = ['image', 'raw', 'video'];
        for (const type of resourceTypes) {
          const resources = await retryOperation(() =>
            cloudinary.api.resources({
              type: 'upload',
              resource_type: type,
              prefix: tempFile.tempFolder,
              max_results: 500,
              timeout: 120000,
            })
          );
          for (const resource of resources.resources) {
            await retryOperation(() =>
              cloudinary.uploader.destroy(resource.public_id, {
                resource_type: resource.resource_type,
              })
            );
            console.log(`✅ Deleted residual file: ${resource.public_id} [${resource.resource_type}]`);
          }
        }

        await retryOperation(() => cloudinary.api.delete_folder(tempFile.tempFolder));
        console.log(`✅ Temporary folder deleted from Cloudinary: ${tempFile.tempFolder}`);
      } catch (error) {
        console.error(`❌ Failed to delete temporary folder ${tempFile.tempFolder} from Cloudinary:`, error.message || 'Unknown error');
      }

      try {
        const deletedTempFile = await TempFile.findByIdAndDelete(tempId);
        if (deletedTempFile) {
          console.log(`✅ Temporary files deleted for tempId: ${tempId}`);
        } else {
          console.warn(`⚠️ No TempFile found for tempId: ${tempId}`);
        }
      } catch (error) {
        console.error(`❌ Failed to delete TempFile ${tempId}:`, error.message);
      }
    } else if (tempFile.files.length === 0) {
      console.log(`ℹ️ No files in TempFile, skipping temporary folder deletion`);
    } else {
      console.warn(`⚠️ Temporary folder ${tempFile.tempFolder} not deleted due to incomplete file transfers`);
    }

    try {
      await retryOperation(() => sendOrderConfirmationEmail(user.email, user.name, {
        ...formData,
        files: tempFile.files.map((file) => file.name).join(', ') || 'No files uploaded',
        orderId,
        initialPayment: session.amount_total / 100,
      }));
      console.log('✅ Order confirmation email sent successfully');
    } catch (emailError) {
      console.error(`❌ Failed to send order confirmation email:`, emailError.message);
      return res.status(200).send({
        message: 'Order submitted successfully, but failed to send confirmation email',
        orderId,
        data: {
          ...formData,
          fileNames: tempFile.files.map((file) => file.name),
          warning: 'Email confirmation could not be sent. Please check your email or contact support.',
        },
      });
    }

    if (tempFile.files.length > 0 && fileMeta.length < tempFile.files.length) {
      console.warn('Some files were not transferred to permanent folder:', failedFiles);
      return res.status(200).send({
        message: 'Order submitted successfully, but some files were not transferred',
        orderId,
        data: {
          ...formData,
          fileNames: tempFile.files.map((file) => file.name),
          warning: `Some files failed to transfer: ${failedFiles.join(', ')}. Please contact support.`,
        },
      });
    }

    res.status(200).send({
      message: 'Order submitted successfully',
      orderId,
      data: {
        ...formData,
        fileNames: tempFile.files.map((file) => file.name),
      },
    });
  } catch (error) {
    console.error('Order finalization failed:', error.message, error);
    res.status(500).send({ error: 'Order finalization failed', details: error.message });
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
        'orderId name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url files.public_id createdAt avatar status paymentStatus initialPayment'
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
    console.error('Error fetching user orders:', error.message, error);
    res.status(500).json({ error: true, message: 'Failed to fetch user orders', details: error.message });
  }
};

export { orderForm, getUserOrders, createCheckoutSession, finalizeOrder, checkSession };