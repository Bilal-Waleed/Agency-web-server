import CancelRequest from "../models/cancelRequestModel.js";
import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import { sendCancelRequestAcceptedEmail, sendCancelRequestDeclinedEmail, sendAdminCancelOrderEmail } from "./email-controller.js";
import cloudinary from "../config/cloudinary.js";

const createCancelRequest = async (req, res) => {
  try {
    const { orderId, reason } = req.body;
    const userEmail = req.user.email;

    if (!orderId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid order ID format" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: true, message: "Order not found" });
    }

    if (order.email !== userEmail) {
      return res.status(403).json({ error: true, message: "You can only cancel orders associated with your email" });
    }

    const existingRequest = await CancelRequest.findOne({ order: orderId });
    if (existingRequest) {
      return res.status(400).json({ error: true, message: "A cancellation request already exists for this order" });
    }

    const cancelRequest = new CancelRequest({
      order: orderId,
      user: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      userAvatar: req.user.avatar,
      reason,
    });

    await cancelRequest.save();

    res.status(200).json({ error: false, message: "Cancellation request submitted successfully" });
  } catch (error) {
    console.error("Error creating cancel request:", error);
    res.status(500).json({ error: true, message: "Failed to submit cancel request", details: error.message });
  }
};

const getCancelRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const cancelRequests = await CancelRequest.find()
      .populate({
        path: 'order',
        select: 'orderId name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url files.public_id createdAt avatar',
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const enhancedRequests = cancelRequests.map((request) => ({
      ...request,
      order: {
        ...request.order,
        filesList: request.order.files?.length > 0 ? request.order.files.map(f => f.name).join(', ') : 'None',
      },
    }));

    const totalRequests = await CancelRequest.countDocuments();
    const totalPages = Math.ceil(totalRequests / limit);

    res.status(200).json({
      error: false,
      message: "Cancel requests fetched successfully",
      data: enhancedRequests,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching cancel requests:", error);
    res.status(500).json({ error: true, message: "Failed to fetch cancel requests" });
  }
};

const acceptCancelRequest = async (req, res) => {
  try {
    const requestId = req.params.id;

    if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid cancel request ID format" });
    }

    const cancelRequest = await CancelRequest.findById(requestId).populate({
      path: 'order',
      select: 'orderId files _id',
    });

    if (!cancelRequest) {
      return res.status(404).json({ error: true, message: "Cancel request not found" });
    }

    const { order, userEmail, userName } = cancelRequest;

    if (order?.files?.length > 0) {
      const folderPrefix = order.files[0].public_id.split('/').slice(0, -1).join('/');
      const resourceTypes = ['image', 'raw', 'video'];

      for (const type of resourceTypes) {
        try {
          await cloudinary.api.delete_resources_by_prefix(folderPrefix, { resource_type: type });
        } catch (err) {
          console.warn(`Could not delete ${type} resources:`, err.message);
        }
      }

      try {
        await cloudinary.api.delete_folder(folderPrefix);
      } catch (err) {
        console.warn("Failed to delete folder:", err.message);
      }
    }

    await Order.findByIdAndDelete(order._id, { suppressChangeStream: true });
    await CancelRequest.findByIdAndDelete(requestId, { suppressChangeStream: true });

    await sendCancelRequestAcceptedEmail(userEmail, userName, order.orderId);

    res.status(200).json({ error: false, message: "Cancel request accepted and order deleted" });
  } catch (error) {
    console.error("Error accepting cancel request:", error);
    res.status(500).json({ error: true, message: "Failed to accept cancel request", details: error.message });
  }
};

const declineCancelRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid cancel request ID format" });
    }

    const cancelRequest = await CancelRequest.findById(requestId).populate({
      path: 'order',
      select: 'orderId',
    });
    if (!cancelRequest) {
      return res.status(404).json({ error: true, message: "Cancel request not found" });
    }

    const { userEmail, userName, order } = cancelRequest;

    await CancelRequest.findByIdAndDelete(requestId, { suppressChangeStream: true });

    await sendCancelRequestDeclinedEmail(userEmail, userName, order.orderId);

    res.status(200).json({ error: false, message: "Cancel request declined" });
  } catch (error) {
    console.error("Error declining cancel request:", error);
    res.status(500).json({ error: true, message: "Failed to decline cancel request", details: error.message });
  }
};

const cancelOrderByAdmin = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { reason } = req.body;

    if (!orderId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid order ID format" });
    }

    const order = await Order.findById(orderId).populate('user');
    if (!order) {
      return res.status(404).json({ error: true, message: "Order not found" });
    }

    let user = order.user;

    if (!user && order.email) {
      user = await User.findOne({ email: order.email });
      if (!user) {
        console.warn("User not found by email. Proceeding with fallback.");
      }
    }

    const userName = user?.name || order.name;
    const userEmail = user?.email || order.email;

    if (order.files?.length > 0) {
      const folderPrefix = order.files[0].public_id.split('/').slice(0, -1).join('/');
      const resourceTypes = ['image', 'raw', 'video'];
      for (const type of resourceTypes) {
        try {
          const deleted = await cloudinary.api.delete_resources_by_prefix(folderPrefix, {
            resource_type: type,
          });
          console.log(`Deleted ${type} resources:`, deleted);
        } catch (err) {
          console.warn(`Could not delete ${type} resources:`, err.message);
        }
      }

      try {
        const deletedFolder = await cloudinary.api.delete_folder(folderPrefix);
        console.log("Deleted folder:", deletedFolder);
      } catch (err) {
        console.warn("Failed to delete folder:", err.message);
      }
    }

    await sendAdminCancelOrderEmail(userEmail, userName, order.orderId, reason);

    await Order.findByIdAndDelete(orderId, { suppressChangeStream: true });

    res.status(200).json({ error: false, message: "Order cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling order by admin:", error);
    res.status(500).json({ error: true, message: "Failed to cancel order", details: error.message });
  }
};

const getUserCancelRequests = async (req, res) => {
  try {
    const userId = req.user._id;
    const cancelRequests = await CancelRequest.find({ user: userId })
      .populate({
        path: 'order',
        select: 'orderId _id',
      })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      error: false,
      message: "User cancel requests fetched successfully",
      data: cancelRequests,
    });
  } catch (error) {
    console.error("Error fetching user cancel requests:", error);
    res.status(500).json({ error: true, message: "Failed to fetch user cancel requests" });
  }
};

export { getUserCancelRequests, createCancelRequest, getCancelRequests, acceptCancelRequest, declineCancelRequest, cancelOrderByAdmin };