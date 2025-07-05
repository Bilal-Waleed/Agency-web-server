import Order from "../models/orderModel.js";
import orderSchema from "../validators/order-schema.js";
import jwt from 'jsonwebtoken';
import { sendOrderConfirmationEmail } from "./email-controller.js";
import User from "../models/userModel.js";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";
import { console } from "inspector";

const uploadToCloudinary = (fileBuffer, folderName, mimetype) => {
  const isRaw = !mimetype.startsWith("image/"); 

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: isRaw ? 'raw' : 'image', 
      },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        return resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );

    Readable.from(fileBuffer).pipe(uploadStream);
  });
};


const orderForm = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).send({ error: 'Authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const validationResult = orderSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).send({
        error: 'Invalid order form data',
        details: validationResult.error.errors,
      });
    }

    const formData = validationResult.data;

    const user = await User.findById(decoded.userID).select('name email avatar');
    if (!user) return res.status(404).send({ error: 'User not found' });

    const files = req.files || [];
    const fileNames = files.map(file => file.originalname); 

    const order = new Order({
      ...formData,
      files: fileNames.map(name => ({ name })),  
      user: decoded.userID,
      avatar: user.avatar || null,
    });

    await order.save();

    res.status(200).send({
      message: 'Order submitted successfully',
      data: {
        ...formData,
        fileNames: fileNames,
      },
    });

    setImmediate(async () => {
      try {
        const timestamp = Date.now();
        const folderName = `orders/${user.name.replace(/\s+/g, '_')}_${timestamp}`;

        const fileUploads = files.map(async (file) => {
          try {
            const result = await uploadToCloudinary(file.buffer, folderName, file.mimetype);
            return {
              name: file.originalname,
              url: result.url,
              type: file.mimetype,
              public_id: result.public_id,
            };
          } catch (error) {
            console.error(`Cloudinary upload failed: ${file.originalname}`, error.message);
            return { name: file.originalname };
          }
        });

        const fileMeta = (await Promise.all(fileUploads)).filter(Boolean);

        await Order.findByIdAndUpdate(order._id, { files: fileMeta });

        sendOrderConfirmationEmail(user.email, user.name, {
          ...formData,
          files: fileNames.join(", "), 
        }).catch(err => console.error("Email sending failed:", err.message));

      } catch (bgError) {
        console.error("Background processing failed:", bgError);
      }
    });

  } catch (error) {
    console.error("Order submission failed:", error);
    return res.status(500).send({
      error: 'Order submission failed',
      details: error.message
    });
  }
};


const getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    console.log('User ID:', userId);
    console.log('User Email:', userEmail);

    const orders = await Order.find({
      $or: [
        { user: userId },
        { email: userEmail }
      ]
    })
      .select('name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url files.public_id createdAt avatar')
      .sort({ createdAt: -1 })
      .lean();

    const enhancedOrders = orders.map((order) => ({
      ...order,
      filesList: order.files?.length > 0 ? order.files.map(f => f.name).join(', ') : 'None',
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



export { orderForm, getUserOrders };
