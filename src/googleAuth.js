const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

function buildOAuthClient(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl(clientId, clientSecret, redirectUri) {
  const client = buildOAuthClient(clientId, clientSecret, redirectUri);
  return client.generateAuthUrl({
    access_type: "offline", // needed to get a refresh_token
    prompt: "consent", // force refresh_token on every connect, even for re-adds
    scope: SCOPES,
  });
}

async function exchangeCode(clientId, clientSecret, redirectUri, code) {
  const client = buildOAuthClient(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const youtube = google.youtube({ version: "v3", auth: client });
  const res = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channelTitle = res.data.items?.[0]?.snippet?.title || "YouTube account";

  return { tokens, channelTitle };
}

module.exports = { getAuthUrl, exchangeCode };
