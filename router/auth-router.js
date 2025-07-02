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
} from "../controllers/auth-controllers.js";

const router = express.Router();

router.get("/", home);
router.post("/register", Register);
router.post("/login", Login);
router.post("/google-register", GoogleRegister);
router.post("/google-login", GoogleLogin);
router.post("/forgot-password", ForgotPassword);
router.post("/reset-password", ResetPassword);
router.get("/user", UserCheck);

export default router;