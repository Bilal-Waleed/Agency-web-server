import oauth2Client from '../utils/googleOAuthClient.js';

export const getAuthUrl = (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  return res.redirect(url);
};

export const handleOAuthCallback = async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('REFRESH TOKEN:', tokens.refresh_token);

    res.send(`
      <h2>Copy this Refresh Token</h2>
      <textarea rows="6" cols="80">${tokens.refresh_token}</textarea>
      <p>Paste it into Railway → Environment Variables → <strong>GOOGLE_REFRESH_TOKEN</strong></p>
    `);
  } catch (error) {
    console.error('Error exchanging code:', error.message);
    res.status(500).send('Failed to retrieve access token');
  }
};
