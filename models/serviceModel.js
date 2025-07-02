import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  provider: { type: String, required: true, trim: true },
  shortDesc: { type: String, required: true, trim: true },
  fullDesc: { type: String, required: true, trim: true },
  image: { type: String, required: true },
  minTime: { type: String, required: true },
  budget: { type: String, required: true },
  faqs: [
    {
      question: { type: String, required: true },
      answer: { type: String, required: true },
    },
  ],
}, { timestamps: true });

export default mongoose.model("Service", serviceSchema);