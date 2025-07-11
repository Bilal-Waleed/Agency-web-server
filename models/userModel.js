import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: false,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  avatar: {
    type: String,
    default: "",
  },
  otp: {
    type: String,
    default: "",
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true
});

const User = mongoose.model("User", userSchema);
export default User;