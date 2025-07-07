import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  viewed: { type: Boolean, default: false },
});

export default mongoose.model('Notification', notificationSchema);