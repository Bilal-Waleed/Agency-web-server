import Notification from "../models/notificationModel.js";

const getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalCount = await Notification.countDocuments();

    res.status(200).json({
      data: notifications,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: true, message: "Failed to fetch notifications" });
  }
};

const markNotificationsViewed = async (req, res) => {
  try {
    await Notification.updateMany(
      { viewed: false },
      { $set: { viewed: true } }
    );
    res.status(200).json({ message: "Notifications marked as viewed" });
  } catch (error) {
    console.error("Error marking notifications viewed:", error);
    res.status(500).json({ error: true, message: "Failed to mark notifications viewed" });
  }
};

export { getNotifications, markNotificationsViewed };