import User from "../models/userModel.js";
import { userRegisterSchema, userLoginSchema } from "../validators/user-schema.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";
import { sendPasswordResetEmail, sendOTPVerificationEmail } from "./email-controller.js";

dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const home = async (req, res) => {
  try {
    res.status(200).send("Welcome to the Home Page!");
  } catch (error) {
    res.status(500).send({ error: "Internal Server Error" });
  }
};

const Register = async (req, res) => {
  try {
    const checkSchema = userRegisterSchema.safeParse(req.body);
    if (!checkSchema.success) {
      return res.status(400).send({ error: checkSchema.error.errors[0].message });
    }

    const { name, email, password } = checkSchema.data;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).send({ error: "Account already exists, please login" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const otp = generateOTP();

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`,
      isAdmin: false,
      otp,
      isVerified: false,
    });

    await newUser.save();

    res.status(200).json({
      message: "User registered successfully. Please verify your OTP.",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        avatar: newUser.avatar,
        isAdmin: newUser.isAdmin,
      },
      userID: newUser._id.toString(),
    });

    await sendOTPVerificationEmail(email, name, otp);

  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};

const GoogleRegister = async (req, res) => {
  try {
    const { credential } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).send({ error: "Account already exists, please login" });
    }

    const otp = generateOTP();

    const newUser = new User({
      name,
      email,
      password: "",
      avatar: picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`,
      isAdmin: false,
      otp,
      isVerified: false,
    });

    await newUser.save();

    res.status(201).send({
      message: "User registered successfully via Google. Please verify your OTP.",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        avatar: newUser.avatar,
        isAdmin: newUser.isAdmin,
      },
      userID: newUser._id.toString(),
    });

    await sendOTPVerificationEmail(email, name, otp);

  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Google registration failed" });
  }
};

const VerifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }

    if (user.otp !== otp) {
      return res.status(400).send({ error: "Invalid OTP" });
    }

    user.otp = "";
    user.isVerified = true;
    await user.save();

    res.status(200).send({ message: "OTP verified successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "OTP verification failed" });
  }
};

const Login = async (req, res) => {
  try {
    const checkSchema = userLoginSchema.safeParse(req.body);
    if (!checkSchema.success) {
      return res.status(400).send({ error: checkSchema.error.errors[0].message });
    }

    const { email, password } = checkSchema.data;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).send({ error: "Invalid email or password" });
    }

    if (!user.isVerified) {
      return res.status(403).send({ error: "Please verify your OTP before logging in" });
    }

    if (!user.password) {
      return res.status(400).send({ error: "No password set. Use Google login or reset your password." });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).send({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      {
        userID: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).send({
      status: 200,
      message: "User logged in successfully",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
      token,
      userID: user._id.toString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ error: "Internal Server Error" });
  }
};

const GoogleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email } = payload;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).send({ error: "No user account found, please register first" });
    }

    if (!user.isVerified) {
      return res.status(403).send({ error: "Please verify your OTP before logging in" });
    }

    const token = jwt.sign(
      {
        userID: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).send({
      message: "Google login successful",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
      },
      token,
      userID: user._id.toString(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Google login failed" });
  }
};

const ForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    const resetToken = jwt.sign({ userID: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    
    await sendPasswordResetEmail(email, user.name, resetLink);

    res.status(200).send({ message: "Password reset link sent" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Failed to send reset link" });
  }
};

const ResetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userID);
    if (!user) {
      return res.status(404).send({ error: "User not found" });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user.password = hashedPassword;
    await user.save();
    res.status(200).send({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Invalid or expired token" });
  }
};

const UserCheck = async (req, res) => {
  if (!req.headers.authorization) {
    return res.status(401).json({
      error: true,
      message: "Token not provided, please login first!",
    });
  }

  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: true, message: "Token missing" });
  }

  try {
    let decodedUser = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decodedUser.userID);

    if (!user) {
      return res.status(401).json({ error: true, message: "User not found" });
    }

    return res.status(200).json({
      error: false,
      message: "User data fetched successfully!",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error('Token Verification Error:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: true,
        message: "Invalid token!",
      });
    }

    if (error.name === 'MongoNetworkError' || error.message.includes('getaddrinfo ENOTFOUND')) {
      return res.status(503).json({
        error: true,
        message: "Database connection failed. Please check your internet connection.",
      });
    }

    return res.status(500).json({
      error: true,
      message: "Something went wrong on the server.",
    });
  }
}



export { home, Register, Login, GoogleRegister, GoogleLogin, ForgotPassword, ResetPassword, UserCheck, VerifyOTP };