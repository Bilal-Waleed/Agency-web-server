import express from "express";
import {
  home,
  Register,
  Login,
  GoogleRegister,
  GoogleLogin,
  ForgotPassword,
  ResetPassword,
  UserCheck,
  VerifyOTP,
} from "../controllers/auth-controllers.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", home);
router.post("/register", Register);
router.post("/login", Login);
router.post("/google-register", GoogleRegister);
router.post("/google-login", GoogleLogin);
router.post("/verify-otp", VerifyOTP);
router.post("/forgot-password", ForgotPassword);
router.post("/reset-password", ResetPassword);
router.get("/user", authMiddleware, UserCheck);

export default router;