import mongoose from 'mongoose';

const tempFileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tempFolder: {
      type: String,
      required: true,
    },
    files: [
      {
        name: { type: String, required: true },
        public_id: { type: String, required: true },
        url: { type: String, required: true },
        type: { type: String, required: true },
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 30 * 60 * 1000), 
    },
  },
  { timestamps: true }
);

tempFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); 

const TempFile = mongoose.model('TempFile', tempFileSchema);
export default TempFile;