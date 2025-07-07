import Notification from "../models/notificationModel.js";

const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json({ data: notifications });
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