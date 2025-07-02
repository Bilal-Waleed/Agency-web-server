import express from 'express';
import {
  getServices,
  getServiceById,
  createService,
} from '../controllers/service-controllers.js';
import upload from '../config/multer.js';

const router = express.Router();

router.get('/', getServices);
router.post('/', upload.single('image'), createService);
router.get('/:id', getServiceById);

export default router;