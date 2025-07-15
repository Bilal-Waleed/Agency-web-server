import jwt from "jsonwebtoken";
import User from "../models/userModel.js";

const isAdminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: true, message: "Authentication required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded);

    const user = await User.findById(decoded.userID).select("isAdmin");
    if (!user) {
      return res.status(404).json({ error: true, message: "User not found" });
    }

    if (!user.isAdmin) {
      return res.status(403).json({ error: true, message: "Admin access required" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Error in isAdminMiddleware:", error.message, error.name);

    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: true, message: "Invalid or expired token" });
    }

    if (error.name === 'MongoNetworkError' || error.message.includes('getaddrinfo ENOTFOUND')) {
      return res.status(503).json({ error: true, message: "Database connection failed. Please check your internet." });
    }

    return res.status(500).json({ error: true, message: "Server error", details: error.message });
  }
};

export default isAdminMiddleware;