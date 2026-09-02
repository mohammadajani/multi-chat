const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "db.json");

function defaultState() {
  return {
    // Advanced (manual) YouTube method - reads public chat by video ID, no login
    youtubeApiKey: "",
    youtubeStreams: [], // [{ id, label, videoId }]

    // Primary YouTube method - Google login, auto-detects your own live broadcasts
    googleClientId: "",
    googleClientSecret: "",
    youtubeAccounts: [], // [{ id, label, tokens: {access_token, refresh_token, expiry_date, scope, token_type} }]

    twitchChannels: [], // [{ id, login, label }]
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

// ---- advanced/manual YouTube (video ID + API key) ----
function setYoutubeApiKey(key) {
  state.youtubeApiKey = key.trim();
  save(state);
  return state;
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

// ---- primary YouTube (Google login) ----
function setGoogleCredentials(clientId, clientSecret) {
  state.googleClientId = clientId.trim();
  state.googleClientSecret = clientSecret.trim();
  save(state);
  return state;
}

function addYoutubeAccount(label, tokens) {
  const entry = { id: crypto.randomUUID(), label, tokens };
  state.youtubeAccounts.push(entry);
  save(state);
  return entry;
}

function updateYoutubeAccountTokens(id, tokens) {
  const acc = state.youtubeAccounts.find((a) => a.id === id);
  if (!acc) return;
  acc.tokens = { ...acc.tokens, ...tokens };
  save(state);
}

function removeYoutubeAccount(id) {
  state.youtubeAccounts = state.youtubeAccounts.filter((a) => a.id !== id);
  save(state);
}

// ---- Twitch ----
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

module.exports = {
  getState,
  setYoutubeApiKey,
  addYoutubeStream,
  removeYoutubeStream,
  setGoogleCredentials,
  addYoutubeAccount,
  updateYoutubeAccountTokens,
  removeYoutubeAccount,
  addTwitchChannel,
  removeTwitchChannel,
};
