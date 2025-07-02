import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).send({ success: false, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userID).select('name email isAdmin');

    if (!user) {
      return res.status(401).send({ success: false, message: 'User not found' });
    }

    req.user = user;

    if (req.path.includes('/accept') || req.path.includes('/reschedule')) {
      if (!user.isAdmin) {
        return res.status(403).send({ success: false, message: 'Admin access required' });
      }
    }

    next();
  } catch (error) {
    res.status(401).send({ success: false, message: 'Invalid token', details: error.message });
  }
};

export default authMiddleware;