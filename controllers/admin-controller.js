import User from "../models/userModel.js";
import Order from "../models/orderModel.js";
import Contact from "../models/contactModel.js";
import Service from "../models/serviceModel.js";
import serviceSchema from "../validators/service-schema.js";
import jwt from "jsonwebtoken";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

const uploadToCloudinary = (fileBuffer, folderName = 'services') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderName },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        return resolve(result.secure_url);
      }
    );
    Readable.from(fileBuffer).pipe(uploadStream);
  });
};

const refreshToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      console.error('No token provided for refresh');
      return res.status(401).json({ error: true, message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token for refresh:', decoded);

    const user = await User.findById(decoded.userID).select("_id name email avatar isAdmin");
    if (!user) {
      console.error('User not found for refresh:', decoded.userID);
      return res.status(404).json({ error: true, message: "User not found" });
    }

    const newToken = jwt.sign(
      { userID: user._id, name: user.name, email: user.email, avatar: user.avatar, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({ error: false, token: newToken });
  } catch (error) {
    console.error('Error refreshing token:', error.message, error.name);
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: true, message: "Invalid or malformed token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: true, message: "Token expired" });
    }
    res.status(500).json({ error: true, message: "Internal server error" });
  }
};

const getDashboardData = async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const end = req.query.end ? new Date(req.query.end) : new Date();
    end.setHours(23, 59, 59, 999);

    const matchStage = {
      $match: {
        createdAt: { $gte: start, $lte: end }
      }
    };

    const dailyOrders = await Order.aggregate([
      matchStage,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:00" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyUsers = await User.aggregate([
      matchStage,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:00" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyContacts = await Contact.aggregate([
      matchStage,
      {
        $group: {
          _id:{ $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+05:00" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const serviceOrders = await Order.aggregate([
      matchStage,
      {
        $group: {
          _id: "$projectType",
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          name: "$_id",
          count: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.status(200).json({
      error: false,
      message: "Dashboard data fetched successfully",
      data: {
        monthlyOrders: dailyOrders,
        monthlyUsers: dailyUsers,
        monthlyContacts: dailyContacts,
        serviceOrders,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: true, message: "Failed to fetch dashboard data" });
  }
};

const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select("name email avatar createdAt isAdmin")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalUsers = await User.countDocuments();
    const totalPages = Math.ceil(totalUsers / limit);

    res.status(200).json({
      error: false,
      message: "Users fetched successfully",
      data: users,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: true, message: "Failed to fetch users" });
  }
};

const deleteUsers = async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({ error: true, message: "userIds array is required" });
    }
    await User.deleteMany({ _id: { $in: userIds } });
    res.status(200).json({ error: false, message: "Users deleted successfully" });
  } catch (error) {
    console.error("Error deleting users:", error);
    res.status(500).json({ error: true, message: "Failed to delete users" });
  }
};

const toggleAdminStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingAdminId = req.user.id;

    if (userId === requestingAdminId) {
      return res.status(400).json({ error: true, message: "You cannot change your own admin status." });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: true, message: "User not found" });

    user.isAdmin = !user.isAdmin;
    await user.save();

    res.status(200).json({ error: false, message: "Admin status updated", user });
  } catch (error) {
    console.error("Error toggling admin status:", error);
    res.status(500).json({ error: true, message: "Failed to update admin status" });
  }
};

const getContacts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const contacts = await Contact.find()
      .select("name email message createdAt avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalContacts = await Contact.countDocuments();
    const totalPages = Math.ceil(totalContacts / limit);

    res.status(200).json({
      error: false,
      message: "Contacts fetched successfully",
      data: contacts,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: true, message: "Failed to fetch contacts" });
  }
};

const getOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find()
      .populate("user", "name email avatar")
      .select("name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url createdAt avatar status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const enhancedOrders = orders.map(order => ({
      ...order,
      filesList: order.files?.length > 0 ? order.files.map(f => f.name).join(', ') : 'None'
    }));

    const totalOrders = await Order.countDocuments();
    const totalPages = Math.ceil(totalOrders / limit);

    res.status(200).json({
      error: false,
      message: "Orders fetched successfully",
      data: enhancedOrders,
      totalPages
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: true, message: "Failed to fetch orders" });
  }
};

const updateService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    if (!serviceId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, error: 'Invalid service ID format' });
    }

    console.log('Incoming req.body.faqs:', req.body.faqs, 'Type:', typeof req.body.faqs);

    let faqs = [];
    if (typeof req.body.faqs === 'string') {
      try {
        faqs = JSON.parse(req.body.faqs);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid FAQs format' });
      }
    }

    const {
      title = '',
      provider = '',
      shortDesc = '',
      fullDesc = '',
      minTime = '',
      budget = '',
      image = ''
    } = req.body;

    const parsedData = serviceSchema.parse({
      title,
      provider,
      shortDesc,
      fullDesc,
      minTime,
      budget,
      image,
      faqs,
    });

    let imageUrl = parsedData.image;
    if (req.file) {
      imageUrl = await uploadToCloudinary(req.file.buffer);
    }

    const updatedService = await Service.findByIdAndUpdate(
      serviceId,
      { ...parsedData, image: imageUrl, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!updatedService) {
      return res.status(404).json({ success: false, error: 'Service not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: updatedService,
    });
  } catch (error) {
    console.error('Error updating service:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid input data',
        details: error.errors,
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to update service',
      details: error.message,
    });
  }
};

const deleteService = async (req, res) => {
  try {
    const serviceId = req.params.id;
    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ error: true, message: "Service not found" });
    }

    if (service.image && service.image.startsWith('https://res.cloudinary.com/')) {
      try {
        const match = service.image.match(/upload\/(?:v\d+\/)?(.+?)\.(jpg|jpeg|png|webp|gif|svg)/i);
        if (match) {
          const publicId = match[1];
          console.log('Final Cloudinary public_id:', publicId);
          const result = await cloudinary.uploader.destroy(publicId);
          console.log('Cloudinary deletion result:', result);
        } else {
          console.warn('Could not extract public_id from URL:', service.image);
        }
      } catch (err) {
        console.error('Error deleting image from Cloudinary:', err.message);
      }
    }

    const deletedService = await Service.findByIdAndDelete(serviceId);
    if (!deletedService) {
      return res.status(404).json({ error: true, message: "Service not found" });
    }

    res.status(200).json({ error: false, message: "Service deleted successfully" });
  } catch (error) {
    console.error("Error deleting service:", error);
    res.status(500).json({ error: true, message: "Failed to delete service", details: error.message });
  }
};

export {
  refreshToken,
  getDashboardData,
  getUsers,
  deleteUsers,
  getContacts,
  getOrders,
  updateService,
  deleteService,
  toggleAdminStatus
};