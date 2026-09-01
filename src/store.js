const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "db.json");

function defaultState() {
  return {
    youtubeApiKey: "",
    twitchChannels: [], // [{ id, login, label }]
    youtubeStreams: [], // [{ id, label, videoId }]
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = defaultState();
    save(initial);
    return initial;
  }
  try {
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(DB_PATH, "utf8")) };
  } catch (err) {
    console.error("[store] db.json corrupt, resetting:", err.message);
    const initial = defaultState();
    save(initial);
    return initial;
  }
}

function save(state) {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

let state = load();

function getState() {
  return state;
}

function setYoutubeApiKey(key) {
  state.youtubeApiKey = key.trim();
  save(state);
  return state;
}

function addTwitchChannel(login, label) {
  login = login.trim().toLowerCase().replace(/^#/, "");
  if (!login) throw new Error("channel login required");
  if (state.twitchChannels.some((c) => c.login === login)) {
    throw new Error(`already added: ${login}`);
  }
  const entry = { id: crypto.randomUUID(), login, label: label?.trim() || login };
  state.twitchChannels.push(entry);
  save(state);
  return entry;
}

function removeTwitchChannel(id) {
  state.twitchChannels = state.twitchChannels.filter((c) => c.id !== id);
  save(state);
}

function addYoutubeStream(videoId, label) {
  videoId = videoId.trim();
  if (!videoId) throw new Error("videoId required");
  if (state.youtubeStreams.some((s) => s.videoId === videoId)) {
    throw new Error(`already added: ${videoId}`);
  }
  const entry = {
    id: crypto.randomUUID(),
    videoId,
    label: label?.trim() || videoId,
  };
  state.youtubeStreams.push(entry);
  save(state);
  return entry;
}

function removeYoutubeStream(id) {
  state.youtubeStreams = state.youtubeStreams.filter((s) => s.id !== id);
  save(state);
}

module.exports = {
  getState,
  setYoutubeApiKey,
  addTwitchChannel,
  removeTwitchChannel,
  addYoutubeStream,
  removeYoutubeStream,
};
