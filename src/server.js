const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { TwitchManager } = require("./twitchChat");
const { YoutubeManager } = require("./youtubeChat");
const { YoutubeAccountManager } = require("./youtubeAccountManager");
const googleAuth = require("./googleAuth");
const store = require("./store");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const recentMessages = [];
const MAX_BUFFER = 200;

function broadcastMessage(msg) {
  recentMessages.push(msg);
  if (recentMessages.length > MAX_BUFFER) recentMessages.shift();
  io.emit("chat_message", msg);
}

function broadcastSourcesUpdated() {
  io.emit("sources_updated", sourceList());
}

// ---- Twitch ----
const twitchManager = new TwitchManager(broadcastMessage);

// ---- Advanced/manual YouTube (video ID + API key) ----
const youtubeManualManager = new YoutubeManager(broadcastMessage);

// ---- Primary YouTube (Google login, auto-discovery) ----
const accountManagers = new Map(); // accountId -> YoutubeAccountManager

function redirectUriFor(req) {
  return `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

function startAccountManager(account, redirectUri) {
  const s = store.getState();
  const manager = new YoutubeAccountManager(account, {
    onMessage: broadcastMessage,
    onTokensRefreshed: (id, tokens) => store.updateYoutubeAccountTokens(id, tokens),
    onBroadcastsChanged: broadcastSourcesUpdated,
    clientId: s.googleClientId,
    clientSecret: s.googleClientSecret,
    redirectUri,
  });
  accountManagers.set(account.id, manager);
  manager.start();
}

// ---- boot from persisted state ----
const initial = store.getState();
youtubeManualManager.setApiKey(initial.youtubeApiKey);
twitchManager.start(initial.twitchChannels);
youtubeManualManager.start(initial.youtubeStreams);
// Google account managers are started lazily on first request (need a
// request to know this server's own host/port for the redirect URI), see
// ensureAccountManagersStarted() below.
let accountManagersStarted = false;
function ensureAccountManagersStarted(req) {
  if (accountManagersStarted) return;
  accountManagersStarted = true;
  const redirectUri = redirectUriFor(req);
  for (const account of store.getState().youtubeAccounts) {
    startAccountManager(account, redirectUri);
  }
}

// ---- helper: current source list for the frontend filter bar ----
function sourceList() {
  const s = store.getState();
  const autoYoutubeSources = [];
  for (const manager of accountManagers.values()) autoYoutubeSources.push(...manager.activeSources());

  return {
    twitch: s.twitchChannels.map((c) => ({
      id: `twitch:${c.login}`,
      dbId: c.id,
      label: c.label,
      login: c.login,
      platform: "twitch",
    })),
    youtube: [
      ...autoYoutubeSources,
      ...s.youtubeStreams.map((y) => ({
        id: `youtube:${y.id}`,
        dbId: y.id,
        label: y.label,
        platform: "youtube",
      })),
    ],
    hasYoutubeKey: !!s.youtubeApiKey,
    hasGoogleCredentials: !!(s.googleClientId && s.googleClientSecret),
    youtubeAccounts: s.youtubeAccounts.map((a) => ({ id: a.id, label: a.label })),
  };
}

// ---- REST: settings ----
app.get("/api/config", (req, res) => {
  ensureAccountManagersStarted(req);
  res.json(sourceList());
});

// -- Twitch --
app.post("/api/twitch", async (req, res) => {
  try {
    const { login, label } = req.body;
    const entry = store.addTwitchChannel(login, label);
    await twitchManager.addChannel(entry.login, entry.label);
    broadcastSourcesUpdated();
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/twitch/:id", async (req, res) => {
  const s = store.getState();
  const entry = s.twitchChannels.find((c) => c.id === req.params.id);
  if (entry) await twitchManager.removeChannel(entry.login);
  store.removeTwitchChannel(req.params.id);
  broadcastSourcesUpdated();
  res.json({ ok: true });
});

// -- Google login (primary YouTube method) --
app.post("/api/google-credentials", (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: "clientId and clientSecret required" });
  }
  store.setGoogleCredentials(clientId, clientSecret);
  res.json({ ok: true });
});

app.get("/auth/google/start", (req, res) => {
  const s = store.getState();
  if (!s.googleClientId || !s.googleClientSecret) {
    return res.status(400).send("Add your Google Client ID/Secret in Settings first.");
  }
  const url = googleAuth.getAuthUrl(s.googleClientId, s.googleClientSecret, redirectUriFor(req));
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  const s = store.getState();
  try {
    const { tokens, channelTitle } = await googleAuth.exchangeCode(
      s.googleClientId,
      s.googleClientSecret,
      redirectUriFor(req),
      req.query.code
    );
    const account = store.addYoutubeAccount(channelTitle, tokens);
    startAccountManager(account, redirectUriFor(req));
    broadcastSourcesUpdated();
    res.redirect("/?connected=" + encodeURIComponent(channelTitle));
  } catch (err) {
    console.error("[google oauth] callback error:", err.message);
    res.status(500).send(`Google sign-in failed: ${err.message}`);
  }
});

app.delete("/api/youtube-account/:id", (req, res) => {
  const manager = accountManagers.get(req.params.id);
  if (manager) {
    manager.stop();
    accountManagers.delete(req.params.id);
  }
  store.removeYoutubeAccount(req.params.id);
  broadcastSourcesUpdated();
  res.json({ ok: true });
});

// -- Advanced/manual YouTube (video ID + API key) --
app.post("/api/youtube-key", (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  store.setYoutubeApiKey(apiKey);
  youtubeManualManager.setApiKey(apiKey);
  res.json({ ok: true });
});

app.post("/api/youtube", async (req, res) => {
  try {
    const { videoId, label } = req.body;
    const entry = store.addYoutubeStream(videoId, label);
    await youtubeManualManager.addStream(entry);
    broadcastSourcesUpdated();
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/youtube/:id", (req, res) => {
  youtubeManualManager.removeStream(req.params.id);
  store.removeYoutubeStream(req.params.id);
  broadcastSourcesUpdated();
  res.json({ ok: true });
});

// ---- sockets ----
io.on("connection", (socket) => {
  socket.emit("history", recentMessages);
  socket.emit("sources_updated", sourceList());
});

const PORT = process.env.PORT || 4545;
server.listen(PORT, () => {
  console.log(`\nMultichat dashboard running: http://localhost:${PORT}\n`);
});
