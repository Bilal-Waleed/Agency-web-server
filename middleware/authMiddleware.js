import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).send({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userID).select('name email isAdmin avatar');

    if (!user) {
      return res.status(401).send({ success: false, message: 'User not found' });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error('Auth Middleware Error:', error.message);

    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).send({ success: false, message: 'Invalid token' });
    }

    if (error.name === 'MongoNetworkError' || error.message.includes('getaddrinfo ENOTFOUND')) {
      return res.status(503).send({ success: false, message: 'Database connection failed. Please check your internet.' });
    }
    return res.status(500).send({ success: false, message: 'Server error', details: error.message });
  }
};

export default authMiddleware;