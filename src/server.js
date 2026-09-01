const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { TwitchManager } = require("./twitchChat");
const { YoutubeManager } = require("./youtubeChat");
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

const twitchManager = new TwitchManager(broadcastMessage);
const youtubeManager = new YoutubeManager(broadcastMessage);

// ---- boot from persisted state ----
const initial = store.getState();
youtubeManager.setApiKey(initial.youtubeApiKey);
twitchManager.start(initial.twitchChannels);
youtubeManager.start(initial.youtubeStreams);

// ---- helper: current source list for the frontend filter bar ----
function sourceList() {
  const s = store.getState();
  return {
    twitch: s.twitchChannels.map((c) => ({
      id: `twitch:${c.login}`, // matches msg.sourceId, used for chat filtering
      dbId: c.id, // matches store's uuid, used for DELETE /api/twitch/:id
      label: c.label,
      login: c.login,
      platform: "twitch",
    })),
    youtube: s.youtubeStreams.map((y) => ({
      id: `youtube:${y.id}`,
      dbId: y.id,
      label: y.label,
      platform: "youtube",
    })),
    hasYoutubeKey: !!s.youtubeApiKey,
  };
}

// ---- REST: settings ----
app.get("/api/config", (req, res) => {
  res.json(sourceList());
});

app.post("/api/youtube-key", (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });
  store.setYoutubeApiKey(apiKey);
  youtubeManager.setApiKey(apiKey);
  res.json({ ok: true });
});

app.post("/api/twitch", async (req, res) => {
  try {
    const { login, label } = req.body;
    const entry = store.addTwitchChannel(login, label);
    await twitchManager.addChannel(entry.login, entry.label);
    io.emit("sources_updated", sourceList());
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
  io.emit("sources_updated", sourceList());
  res.json({ ok: true });
});

app.post("/api/youtube", async (req, res) => {
  try {
    const { videoId, label } = req.body;
    const entry = store.addYoutubeStream(videoId, label);
    await youtubeManager.addStream(entry);
    io.emit("sources_updated", sourceList());
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/youtube/:id", (req, res) => {
  youtubeManager.removeStream(req.params.id);
  store.removeYoutubeStream(req.params.id);
  io.emit("sources_updated", sourceList());
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
