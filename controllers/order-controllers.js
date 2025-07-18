import Order from '../models/orderModel.js';
import TempFile from '../models/tempFileModel.js';
import orderSchema from '../validators/order-schema.js';
import jwt from 'jsonwebtoken';
import { sendOrderConfirmationEmail } from './email-controller.js';
import User from '../models/userModel.js';
import Stripe from 'stripe';
import { calculateHalfPayment } from '../utils/payment.js';
import { retryOperation, uploadToCloudinary } from '../utils/cloudinary.js';
import { completeOrderProcessing } from '../utils/order.js';
import cloudinary from '../config/cloudinary.js';

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

const checkSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`ℹ️ Checking session ${sessionId}:`, session.status);

    if (session.status === 'complete' && session.payment_status === 'paid') {
      const { orderId, fileMeta, message, orderData, tempId, userId, folderPath } = session.metadata;

      if (orderId && fileMeta) {
        try {
          await completeOrderProcessing(orderId, fileMeta, message, req.app.get('io'), folderPath);
          return res.status(200).json({ success: true, isRemainingPayment: true });
        } catch (error) {
          console.error(`❌ Failed to process order ${orderId}:`, error.message);
          return res.status(500).json({ error: error.message, isRemainingPayment: true });
        }
      } else if (orderData && tempId && userId) {
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
        console.error(`❌ Cloudinary upload failed for ${file.originalname}:`, error.message);
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
      createdAt: new Date(),
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
            const newPublicId = `${permanentFolder}/${safeFileName.split('.').slice(0, -1).join('.')}`;

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
            const fileBuffer = Buffer.from(await response.arrayBuffer()); // Updated to arrayBuffer

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
              cloudinary.uploader.destroy(resource.public_id, { resource_type: resource.resource_type })
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