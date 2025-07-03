import CancelRequest from "../models/cancelRequestModel.js";
import Order from "../models/orderModel.js";
import { sendCancelRequestAcceptedEmail, sendCancelRequestDeclinedEmail } from "./email-controller.js";
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
        populate: { path: 'user', select: 'name email avatar' },
        select: 'name email phone projectType projectBudget timeline projectDescription paymentReference paymentMethod files.name files.url files.public_id createdAt avatar',
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

const getCloudinaryResourceType = (file) => {
  if (!file?.url) return 'image'; 

  const url = file.url;
  if (url.includes('/image/upload/')) return 'image';
  if (url.includes('/video/upload/')) return 'video';
  if (url.includes('/raw/upload/')) return 'raw';
  
  return 'image'; 
};

const acceptCancelRequest = async (req, res) => {
  try {
    const requestId = req.params.id;

    if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid cancel request ID format" });
    }

    const cancelRequest = await CancelRequest.findById(requestId)
      .populate({
        path: 'order',
        select: 'files _id',
      })
      .populate('user');

    if (!cancelRequest) {
      return res.status(404).json({ error: true, message: "Cancel request not found" });
    }

    const { order, user } = cancelRequest;

    if (order.files?.length > 0) {
      console.log("📦 Total Files to delete:", order.files.length);

      for (const file of order.files) {
        console.log("🧾 Deleting file:", file);

        const resourceType = getCloudinaryResourceType(file);

        if (file.public_id) {
          try {
            const result = await cloudinary.uploader.destroy(file.public_id, {
              resource_type: resourceType,
            });
            console.log(`✅ Deleted (${resourceType}) via public_id:`, result);
          } catch (error) {
            console.error(`❌ Failed to delete (${resourceType}) ${file.public_id}:`, error.message);
          }
        } else {
          console.warn("⚠️ Skipped (no public_id):", file.name);
        }
      }
    }

    await Order.findByIdAndDelete(order._id);
    await CancelRequest.findByIdAndDelete(requestId);

    await sendCancelRequestAcceptedEmail(user.email, user.name, order._id);

    res.status(200).json({ error: false, message: "Cancel request accepted and order deleted" });

  } catch (error) {
    console.error("❌ Error accepting cancel request:", error);
    res.status(500).json({ error: true, message: "Failed to accept cancel request", details: error.message });
  }
};

const declineCancelRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    if (!requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: true, message: "Invalid cancel request ID format" });
    }

    const cancelRequest = await CancelRequest.findById(requestId).populate('user');
    if (!cancelRequest) {
      return res.status(404).json({ error: true, message: "Cancel request not found" });
    }

    const userEmail = cancelRequest.user.email;
    const userName = cancelRequest.user.name;

    await CancelRequest.findByIdAndDelete(requestId);

    await sendCancelRequestDeclinedEmail(userEmail, userName, cancelRequest.order._id);

    res.status(200).json({ error: false, message: "Cancel request declined" });
  } catch (error) {
    console.error("Error declining cancel request:", error);
    res.status(500).json({ error: true, message: "Failed to decline cancel request", details: error.message });
  }
};

export { createCancelRequest, getCancelRequests, acceptCancelRequest, declineCancelRequest };