const tmi = require("tmi.js");

/**
 * Connects anonymously to Twitch chat for any number of channels and emits
 * a normalized message object for every chat message seen.
 *
 * @param {string[]} channels - Twitch channel logins (lowercase, no '#')
 * @param {(msg: object) => void} onMessage - callback for each normalized message
 * @returns {import('tmi.js').Client}
 */
function startTwitchChat(channels, onMessage) {
  if (!channels || channels.length === 0) {
    console.log("[twitch] no channels configured, skipping");
    return null;
  }

  const client = new tmi.Client({
    // Anonymous read-only connection - no OAuth token needed to read public chat.
    channels,
  });

  client.on("message", (channel, tags, message, self) => {
    if (self) return;
    onMessage({
      platform: "twitch",
      source: channel.replace(/^#/, ""),
      id: tags.id,
      author: tags["display-name"] || tags.username,
      color: tags.color || null,
      isMod: !!tags.mod || tags.badges?.broadcaster === "1",
      isSub: !!tags.subscriber,
      message,
      timestamp: Date.now(),
    });
  });

  client.on("connected", (addr, port) => {
    console.log(`[twitch] connected, watching: ${channels.join(", ")}`);
  });

  client.connect().catch((err) => {
    console.error("[twitch] connection error:", err.message);
  });

  return client;
}

module.exports = { startTwitchChat };
