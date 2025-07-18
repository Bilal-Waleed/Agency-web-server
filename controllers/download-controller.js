import Order from '../models/orderModel.js';
import User from '../models/userModel.js';
import mongoose from 'mongoose';
import { sendOrderRemainingPaymentEmail } from './email-controller.js';
import cloudinary from '../config/cloudinary.js';
import { Readable } from 'stream';
import Stripe from 'stripe';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import AdmZip from 'adm-zip';
import axios from 'axios';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

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
    const public_id = `${folderName}/${safeFileName.split('.').slice(0, -1).join('.')}`; // Remove extension for images

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
  const [min, max] = budget.replace('$', '').split('-').map((val) => parseFloat(val) || 0);
  if (budget.includes('+')) return 2500;
  return ((min + (max || min)) / 2) * 0.5;
};

const downloadOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid order ID format" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "name email avatar")
      .select("name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.url files.name createdAt avatar")
      .lean();

    if (!order) {
      return res.status(404).json({ error: true, message: "Order not found" });
    }

    const zip = new AdmZip();

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Order Details",
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 200 },
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Order ID")],
                      width: { size: 30, type: WidthType.PERCENTAGE },
                    }),
                    new TableCell({
                      children: [new Paragraph(order._id.toString())],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Name")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.name || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Email")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.email || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Phone")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.phone || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Type")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectType || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Budget")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectBudget || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Timeline")],
                    }),
                    new TableCell({
                      children: [new Paragraph(new Date(order.timeline).toLocaleDateString() || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Project Description")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.projectDescription || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Payment Reference")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.paymentReference || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Payment Method")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.paymentMethod || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Created At")],
                    }),
                    new TableCell({
                      children: [new Paragraph(new Date(order.createdAt).toLocaleDateString() || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Avatar URL")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.avatar || "N/A")],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("Files")],
                    }),
                    new TableCell({
                      children: [new Paragraph(order.files?.map(f => f.name).join(", ") || "None")],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });

    const docBuffer = await Packer.toBuffer(doc);
    zip.addFile("order_details.docx", docBuffer);

    for (let i = 0; i < order.files.length; i++) {
      const file = order.files[i];
      if (file.url && file.name) {
        try {
          const response = await axios.get(file.url, { responseType: 'arraybuffer' });
          zip.addFile(file.name, Buffer.from(response.data)); 
        } catch (error) {
          console.error(`Error fetching file ${file.name}:`, error.message);
        }
      }
    }

    const zipBuffer = zip.toBuffer();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=order_${orderId}.zip`);
    res.setHeader('Content-Length', zipBuffer.length);

    res.send(zipBuffer);
  } catch (error) {
    console.error("Error generating order ZIP:", error);
    res.status(500).json({ error: true, message: "Failed to generate order ZIP", details: error.message });
  }
};

const completeOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { message } = req.body;
    const files = req.files || [];

    for (let file of files) {
      if (file.size > MAX_SINGLE_FILE_SIZE) {
        return res.status(400).json({
          error: true,
          message: `${file.originalname} is larger than 25MB.`,
        });
      }
    }

    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return res.status(400).json({
        error: true,
        message: `Total size of all files exceeds 25MB.`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: true, message: 'Invalid order ID' });
    }

    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      return res.status(404).json({ error: true, message: 'Order not found' });
    }

    let user = order.user;
    if (!user && order.email) {
      user = await User.findOne({ email: order.email });
      if (!user) {
        console.warn('User not found by email. Proceeding with fallback.');
      }
    }

    const userName = user?.name || order.name;
    const userEmail = user?.email || order.email;

    const remainingAmount = Math.round(calculateHalfPayment(order.projectBudget) * 100);

    const folderName = `completed_orders/${order.orderId}_${Date.now()}`;
    const fileUploads = files.map(async (file) => {
      try {
        const result = await retryOperation(() =>
          uploadToCloudinary(file.buffer, folderName, file.mimetype, file.originalname)
        );
        return {
          name: file.originalname,
          url: result.url,
          type: file.mimetype,
          public_id: result.public_id,
          resource_type: result.resource_type || 'raw',
        };
      } catch (error) {
        console.error(`Cloudinary upload failed: ${file.originalname}`, error.message);
        return null;
      }
    });

    const fileMeta = (await Promise.all(fileUploads)).filter(Boolean);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Remaining Payment for Order ${order.orderId}`,
            },
            unit_amount: remainingAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/order`,
      metadata: {
        orderId: order._id.toString(),
        userId: order.user ? order.user._id.toString() : 'anonymous',
        fileMeta: JSON.stringify(fileMeta),
        message: message || '',
      },
    });

    await Order.findByIdAndUpdate(orderId, {
      completedFiles: fileMeta,
      remainingPaymentSessionId: session.id,
    });

    try {
      await retryOperation(() =>
        sendOrderRemainingPaymentEmail(userEmail, userName, order.orderId, message, session.url)
      );
      console.log(`Remaining payment email sent to ${userEmail} for order ${order.orderId}`);
    } catch (emailError) {
      console.error(`Failed to send remaining payment email for order ${order.orderId}:`, emailError.message);
    }

    res.status(200).json({
      error: false,
      message: 'Order completion initiated. Payment link sent to user.',
    });
  } catch (error) {
    console.error('Error completing order:', error);
    res.status(500).json({
      error: true,
      message: 'Failed to complete order',
      details: error.message,
    });
  }
};

export { downloadOrder, completeOrder };