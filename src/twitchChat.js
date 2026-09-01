const tmi = require("tmi.js");

/**
 * Manages one anonymous tmi.js client that can join/part any number of
 * Twitch channels at runtime (e.g. for friends' channels added via Settings).
 */
class TwitchManager {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.client = new tmi.Client({ channels: [] });
    this.joined = new Set(); // logins currently joined

    this.client.on("message", (channel, tags, message, self) => {
      if (self) return;
      const login = channel.replace(/^#/, "");
      this.onMessage({
        platform: "twitch",
        sourceId: `twitch:${login}`,
        source: this.labels.get(login) || login,
        id: tags.id,
        author: tags["display-name"] || tags.username,
        color: tags.color || null,
        isMod: !!tags.mod || tags.badges?.broadcaster === "1",
        isSub: !!tags.subscriber,
        message,
        timestamp: Date.now(),
      });
    });

    this.labels = new Map(); // login -> display label
    this.connected = false;
  }

  async start(channels) {
    // channels: [{ login, label }]
    await this.client.connect().catch((err) => {
      console.error("[twitch] connection error:", err.message);
    });
    this.connected = true;
    for (const c of channels) {
      await this.addChannel(c.login, c.label);
    }
  }

  async addChannel(login, label) {
    login = login.toLowerCase();
    this.labels.set(login, label || login);
    if (this.joined.has(login)) return;
    if (!this.connected) return; // will be picked up by start()
    try {
      await this.client.join(login);
      this.joined.add(login);
      console.log(`[twitch] joined #${login}`);
    } catch (err) {
      console.error(`[twitch] failed to join #${login}:`, err.message);
    }
  }

  async removeChannel(login) {
    login = login.toLowerCase();
    if (!this.joined.has(login)) return;
    try {
      await this.client.part(login);
    } catch (err) {
      console.error(`[twitch] failed to part #${login}:`, err.message);
    }
    this.joined.delete(login);
    this.labels.delete(login);
  }
}

module.exports = { TwitchManager };
