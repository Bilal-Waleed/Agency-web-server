import mongoose from "mongoose";

const cancelRequestSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

const CancelRequest = mongoose.model("CancelRequest", cancelRequestSchema);
export default CancelRequest;