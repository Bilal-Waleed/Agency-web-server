import express from "express";
import {
  refreshToken,
  getDashboardData,
  getUsers,
  deleteUsers,
  getContacts,
  getOrders,
  updateService,
  deleteService,
  toggleAdminStatus
} from "../controllers/admin-controller.js";
import { createCancelRequest, getCancelRequests, acceptCancelRequest, declineCancelRequest, cancelOrderByAdmin } from "../controllers/cancel-request-controller.js";
import { createService, getServices } from "../controllers/service-controllers.js";
import { downloadOrder, completeOrder } from "../controllers/download-controller.js";
import { upload, imageUpload } from "../config/multer.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", isAdminMiddleware, getDashboardData);
router.get("/users", isAdminMiddleware, getUsers);
router.put("/users/:userId/toggle-admin", isAdminMiddleware, toggleAdminStatus);
router.delete("/users", isAdminMiddleware, deleteUsers);
router.get("/contacts", isAdminMiddleware, getContacts);
router.get('/orders', isAdminMiddleware, getOrders);
router.get("/orders/:id/download", isAdminMiddleware, downloadOrder);
router.post("/orders/:id/cancel", authMiddleware, isAdminMiddleware, cancelOrderByAdmin);
router.post("/orders/:id/complete", authMiddleware, isAdminMiddleware, upload.array('files'), completeOrder);
router.get("/cancel-requests", authMiddleware, isAdminMiddleware, getCancelRequests);
router.post("/cancel-requests/:id/accept", authMiddleware, isAdminMiddleware, acceptCancelRequest);
router.post("/cancel-requests/:id/decline", authMiddleware, isAdminMiddleware, declineCancelRequest);
router.get("/services", isAdminMiddleware, getServices);
router.post("/services", isAdminMiddleware, imageUpload.single("image"), createService);
router.put("/services/:id", isAdminMiddleware, imageUpload.single("image"), updateService);
router.delete("/services/:id", isAdminMiddleware, deleteService);
router.post("/refresh-token", refreshToken);
router.post("/cancel-requests", authMiddleware, createCancelRequest);

export default router;