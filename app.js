import express from 'express';
import authRouter from './router/auth-router.js';
import contactRouter from './router/contact-router.js';
import orderRouter from './router/order-router.js';
import serviceRouter from './router/service-router.js';
import connectDB from './config/db.js';
import dotenv from 'dotenv';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import { setupChangeStream } from './socket/changeStream.js';
import adminRouter from './router/admin-router.js';
import scheduledMeetingRouter from './router/scheduledMeeting-router.js';
import notificationRoutes from './router/notificationRoutes.js';
import stripeWebhookRouter from './config/stripe-webhook.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('A client connected:', socket.id);
  socket.join('adminRoom'); 
  socket.on('disconnect', () => {
    console.log('A client disconnected:', socket.id);
  });
});

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

app.use('/api/stripe', stripeWebhookRouter);
app.use('/api/auth', authRouter);
app.use('/api/contact', contactRouter);
app.use('/api/order', orderRouter);
app.use('/api/services', serviceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/scheduled-meetings', scheduledMeetingRouter);
app.use('/api/notifications', notificationRoutes);
app.use('/images', express.static('public/images'));

(async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
    setupChangeStream(io);
  } catch (error) {
    console.error('Failed to set up server:', error.message);
  }
})();

try {
  const { startCronJob } = await import('./config/cron-job.js');
  startCronJob(io);
} catch (error) {
  console.warn('Cron job not found or failed to start:', error.message);
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});