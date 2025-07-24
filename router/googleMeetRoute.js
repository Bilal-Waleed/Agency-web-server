import express from 'express';
import { getAuthUrl, handleOAuthCallback } from '../controllers/googleAuthController.js';

const router = express.Router();

router.get('/auth', getAuthUrl);
router.get('/oauth2callback', handleOAuthCallback);

export default router;
