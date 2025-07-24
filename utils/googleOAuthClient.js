import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://agency-web-server-production-0b56.up.railway.app/oauth2callback'
);

export default oauth2Client;
