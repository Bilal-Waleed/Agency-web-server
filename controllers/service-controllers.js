import Service from "../models/serviceModel.js";
import serviceSchema from "../validators/service-schema.js";
import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

const uploadToCloudinary = (fileBuffer, folderName = 'services') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderName },
      (error, result) => {
        if (error) return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        return resolve(result.secure_url);
      }
    );
    Readable.from(fileBuffer).pipe(uploadStream);
  });
};

export const getServices = async (req, res) => {
  try {
    const services = await Service.find();
    res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      data: services,
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch services",
      details: error.message,
    });
  }
};

export const getServiceById = async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ success: false, error: "Service not found" });
    }
    res.status(200).json({
      success: true,
      message: "Service fetched successfully",
      data: service,
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch service",
      details: error.message,
    });
  }
};

export const createService = async (req, res) => {
  try {
    let faqs = [];
    if (typeof req.body.faqs === 'string') {
      try {
        faqs = JSON.parse(req.body.faqs);
      } catch {
        return res.status(400).json({ success: false, error: "Invalid FAQs format" });
      }
    }

    const {
      title = '',
      provider = '',
      shortDesc = '',
      fullDesc = '',
      minTime = '',
      budget = '',
      image = ''
    } = req.body;

    const parsedData = serviceSchema.parse({
      title,
      provider,
      shortDesc,
      fullDesc,
      minTime,
      budget,
      image,
      faqs,
    });

    let imageUrl = parsedData.image;
    if (req.file) {
      imageUrl = await uploadToCloudinary(req.file.buffer);
    }

    const service = await Service.create({ ...parsedData, image: imageUrl });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service,
    });
  } catch (error) {
    console.error('Error creating service:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid service data',
        details: error.errors,
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create service',
      details: error.message,
    });
  }
};
