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
import { createService, getServices } from "../controllers/service-controllers.js";
import { downloadOrder } from "../controllers/download-controller.js";
import upload from "../config/multer.js";
import isAdminMiddleware from "../middleware/isAdminMiddleware.js";

const router = express.Router();

router.get("/dashboard", isAdminMiddleware, getDashboardData);
router.get("/users", isAdminMiddleware, getUsers);
router.delete("/users", isAdminMiddleware, deleteUsers);
router.get("/contacts", isAdminMiddleware, getContacts);
router.get('/orders', isAdminMiddleware, getOrders);
router.get("/orders/:id/download", isAdminMiddleware, downloadOrder);
router.get("/services", isAdminMiddleware, getServices);
router.post("/services", isAdminMiddleware, upload.single("image"), createService);
router.put("/services/:id", isAdminMiddleware, upload.single("image"), updateService);
router.delete("/services/:id", isAdminMiddleware, deleteService);
router.put("/users/:userId/toggle-admin", isAdminMiddleware, toggleAdminStatus);
router.post("/refresh-token", refreshToken);

export default router;