const socket = io();
const feedEl = document.getElementById("feed");
const filtersEl = document.getElementById("filters");

// source key -> enabled state. Populated the first time each source is seen.
const activeSources = new Map();

function sourceKey(msg) {
  return `${msg.platform}:${msg.source}`;
}

function ensureFilterChip(msg) {
  const key = sourceKey(msg);
  if (activeSources.has(key)) return;
  activeSources.set(key, true);

  const chip = document.createElement("div");
  chip.className = "filter-chip active";
  chip.textContent = msg.source;
  chip.dataset.key = key;
  chip.addEventListener("click", () => {
    const enabled = !activeSources.get(key);
    activeSources.set(key, enabled);
    chip.classList.toggle("active", enabled);
    applyFilter();
  });
  filtersEl.appendChild(chip);
}

function applyFilter() {
  document.querySelectorAll(".msg").forEach((el) => {
    const enabled = activeSources.get(el.dataset.key);
    el.style.display = enabled ? "flex" : "none";
  });
}

function renderMessage(msg) {
  ensureFilterChip(msg);

  const row = document.createElement("div");
  row.className = "msg";
  if (msg.isMod) row.classList.add("mod");
  if (msg.isSub) row.classList.add("sub");
  row.dataset.key = sourceKey(msg);

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
  feedEl.appendChild(row);

  const atBottom =
    feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;

  // trim old messages so the DOM doesn't grow forever
  while (feedEl.children.length > 300) {
    feedEl.removeChild(feedEl.firstChild);
  }

  if (atBottom) feedEl.scrollTop = feedEl.scrollHeight;
}

socket.on("history", (messages) => {
  messages.forEach(renderMessage);
});

socket.on("chat_message", renderMessage);
