const socket = io();
const feedEl = document.getElementById("feed");
const sourceFiltersEl = document.getElementById("sourceFilters");
const groupFiltersEl = document.getElementById("groupFilters");

let currentGroup = "all"; // 'all' | 'twitch' | 'youtube'
const disabledSources = new Set(); // sourceIds explicitly toggled off

// ---- filtering ----
function messageVisible(msg) {
  if (currentGroup !== "all" && msg.platform !== currentGroup) return false;
  if (disabledSources.has(msg.sourceId)) return false;
  return true;
}

function applyFilterToDOM() {
  document.querySelectorAll(".msg").forEach((el) => {
    const visible =
      (currentGroup === "all" || el.dataset.platform === currentGroup) &&
      !disabledSources.has(el.dataset.sourceId);
    el.style.display = visible ? "flex" : "none";
  });
}

groupFiltersEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".filter-chip.group");
  if (!chip) return;
  currentGroup = chip.dataset.group;
  groupFiltersEl.querySelectorAll(".filter-chip.group").forEach((c) =>
    c.classList.toggle("active", c === chip)
  );
  applyFilterToDOM();
});

// ---- dynamic per-source chip bar (built from server config, not just seen messages) ----
function renderSourceChips(config) {
  sourceFiltersEl.innerHTML = "";
  const all = [...config.twitch, ...config.youtube];
  all.forEach((src) => {
    const chip = document.createElement("div");
    chip.className = "filter-chip active";
    chip.textContent = src.label;
    chip.dataset.id = src.id;
    if (disabledSources.has(src.id)) chip.classList.remove("active");
    chip.addEventListener("click", () => {
      if (disabledSources.has(src.id)) {
        disabledSources.delete(src.id);
        chip.classList.add("active");
      } else {
        disabledSources.add(src.id);
        chip.classList.remove("active");
      }
      applyFilterToDOM();
    });
    sourceFiltersEl.appendChild(chip);
  });
}

// ---- message rendering ----
function renderMessage(msg) {
  const row = document.createElement("div");
  row.className = "msg";
  if (msg.isMod) row.classList.add("mod");
  if (msg.isSub) row.classList.add("sub");
  row.dataset.sourceId = msg.sourceId;
  row.dataset.platform = msg.platform;

  const tag = document.createElement("span");
  tag.className = `tag ${msg.platform}`;
  tag.textContent = msg.source;

  const author = document.createElement("span");
  author.className = "author";
  author.style.color = msg.color || "";
  author.textContent = msg.author;

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = msg.message;

  row.append(tag, author, text);
  if (!messageVisible(msg)) row.style.display = "none";
  feedEl.appendChild(row);

  const atBottom =
    feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;

  while (feedEl.children.length > 300) feedEl.removeChild(feedEl.firstChild);
  if (atBottom) feedEl.scrollTop = feedEl.scrollHeight;
}

socket.on("history", (messages) => messages.forEach(renderMessage));
socket.on("chat_message", renderMessage);
socket.on("sources_updated", (config) => {
  renderSourceChips(config);
  refreshSettingsLists(config);
});

// ---- settings panel ----
const overlay = document.getElementById("settingsOverlay");
document.getElementById("settingsBtn").addEventListener("click", async () => {
  overlay.classList.remove("hidden");
  const config = await fetchConfig();
  renderSourceChips(config);
  refreshSettingsLists(config);
});
document.getElementById("closeSettings").addEventListener("click", () => {
  overlay.classList.add("hidden");
});
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.add("hidden");
});

async function fetchConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

function refreshSettingsLists(config) {
  // -- Google sign-in section --
  document.getElementById("redirectUriHint").textContent =
    `${window.location.origin}/auth/google/callback`;
  document.getElementById("googleCredsForm").classList.toggle(
    "hidden",
    config.hasGoogleCredentials
  );
  document.getElementById("connectGoogleBtn").style.display = config.hasGoogleCredentials
    ? "block"
    : "none";

  const accountList = document.getElementById("youtubeAccountList");
  accountList.innerHTML = "";
  config.youtubeAccounts.forEach((a) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${a.label}</span>`;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "Disconnect";
    btn.addEventListener("click", () => removeYoutubeAccount(a.id));
    li.appendChild(btn);
    accountList.appendChild(li);
  });

  // -- Advanced/manual section --
  const keyStatus = document.getElementById("keyStatus");
  keyStatus.textContent = config.hasYoutubeKey
    ? "A YouTube API key is currently saved."
    : "No YouTube API key saved yet — manual video-ID sources won't connect until you add one.";

  const youtubeList = document.getElementById("youtubeList");
  youtubeList.innerHTML = "";
  config.youtube
    .filter((y) => y.dbId) // only manually-added entries have a dbId / are removable here
    .forEach((y) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${y.label}</span>`;
      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.textContent = "Remove";
      btn.addEventListener("click", () => removeYoutube(y.dbId));
      li.appendChild(btn);
      youtubeList.appendChild(li);
    });

  // -- Twitch section --
  const twitchList = document.getElementById("twitchList");
  twitchList.innerHTML = "";
  config.twitch.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${c.label}${c.label !== c.login ? ` (${c.login})` : ""}</span>`;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeTwitch(c.dbId));
    li.appendChild(btn);
    twitchList.appendChild(li);
  });
}

document.getElementById("saveGoogleCredsBtn").addEventListener("click", async () => {
  const clientId = document.getElementById("googleClientIdInput").value.trim();
  const clientSecret = document.getElementById("googleClientSecretInput").value.trim();
  if (!clientId || !clientSecret) return;
  const res = await fetch("/api/google-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (res.ok) {
    refreshSettingsLists(await fetchConfig());
  } else {
    const err = await res.json();
    alert(err.error || "failed to save credentials");
  }
});

document.getElementById("connectGoogleBtn").addEventListener("click", () => {
  window.location.href = "/auth/google/start";
});

async function removeYoutubeAccount(id) {
  await fetch(`/api/youtube-account/${id}`, { method: "DELETE" });
}

document.getElementById("advancedToggle").addEventListener("click", () => {
  document.getElementById("advancedPanel").classList.toggle("hidden");
});

document.getElementById("saveKeyBtn").addEventListener("click", async () => {
  const input = document.getElementById("youtubeKeyInput");
  if (!input.value.trim()) return;
  await fetch("/api/youtube-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: input.value.trim() }),
  });
  input.value = "";
  refreshSettingsLists(await fetchConfig());
});

document.getElementById("addTwitchBtn").addEventListener("click", async () => {
  const login = document.getElementById("twitchLoginInput").value.trim();
  const label = document.getElementById("twitchLabelInput").value.trim();
  if (!login) return;
  const res = await fetch("/api/twitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, label }),
  });
  if (res.ok) {
    document.getElementById("twitchLoginInput").value = "";
    document.getElementById("twitchLabelInput").value = "";
  } else {
    const err = await res.json();
    alert(err.error || "failed to add channel");
  }
});

document.getElementById("addYoutubeBtn").addEventListener("click", async () => {
  const videoId = document.getElementById("youtubeVideoIdInput").value.trim();
  const label = document.getElementById("youtubeLabelInput").value.trim();
  if (!videoId) return;
  const res = await fetch("/api/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, label }),
  });
  if (res.ok) {
    document.getElementById("youtubeVideoIdInput").value = "";
    document.getElementById("youtubeLabelInput").value = "";
  } else {
    const err = await res.json();
    alert(err.error || "failed to add stream");
  }
});

async function removeTwitch(dbId) {
  await fetch(`/api/twitch/${dbId}`, { method: "DELETE" });
}
async function removeYoutube(dbId) {
  await fetch(`/api/youtube/${dbId}`, { method: "DELETE" });
}

// initial load
fetchConfig().then((config) => {
  renderSourceChips(config);
  refreshSettingsLists(config);
});

// after a Google sign-in redirect, reopen settings so the new account is visible
const params = new URLSearchParams(window.location.search);
if (params.has("connected")) {
  overlay.classList.remove("hidden");
  window.history.replaceState({}, "", window.location.pathname);
}
