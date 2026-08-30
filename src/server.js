const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { startTwitchChat } = require("./twitchChat");
const { startYoutubeChats } = require("./youtubeChat");

let config;
try {
  config = require("../config.js");
} catch (err) {
  console.error(
    "\nMissing config.js — copy config.example.js to config.js and fill in your values.\n"
  );
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..", "public")));

// keep a small rolling buffer so newly-opened dashboard tabs aren't empty
const recentMessages = [];
const MAX_BUFFER = 200;

function broadcastMessage(msg) {
  recentMessages.push(msg);
  if (recentMessages.length > MAX_BUFFER) recentMessages.shift();
  io.emit("chat_message", msg);
}

io.on("connection", (socket) => {
  socket.emit("history", recentMessages);
});

startTwitchChat(config.twitchChannels, broadcastMessage);
startYoutubeChats(
  config.youtubeApiKey,
  config.youtubeStreams,
  config.youtubeMinPollMs || 3000,
  broadcastMessage
);

const port = config.port || 4545;
server.listen(port, () => {
  console.log(`\nMultichat dashboard running: http://localhost:${port}\n`);
});
