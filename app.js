import express from "express";
import authRouter from "./router/auth-router.js";
import contactRouter from "./router/contact-router.js";
import orderRouter from "./router/order-router.js";
import serviceRouter from "./router/service-router.js";
import connectDB from "./config/db.js";
import dotenv from "dotenv";
import cors from "cors";
import { Server } from "socket.io";
import http from "http";
import { setupChangeStream } from "./socket/adminChangeStream.js"; 
import adminRouter from "./router/admin-router.js";
import scheduledMeetingRouter from './router/scheduledMeeting-router.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("A client disconnected:", socket.id);
  });
});

// Make io accessible in routes/controllers
app.set("io", io);

app.use(cors());
app.use(express.json());
app.use('/images', express.static('public/images')); 

app.use("/api/auth", authRouter);
app.use("/api/contact", contactRouter);
app.use("/api/order", orderRouter);
app.use("/api/services", serviceRouter);
app.use("/api/admin", adminRouter);
app.use("/api/scheduled-meetings", scheduledMeetingRouter);

// Connect to MongoDB and set up change stream
connectDB().then(() => {
  setupChangeStream(io); // Use adminChangeStream.js
});

// Use server.listen instead of app.listen
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});