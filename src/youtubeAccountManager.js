const { google } = require("googleapis");

const DISCOVERY_INTERVAL_MS = 30000; // how often to re-check for new/ended live broadcasts
const MIN_POLL_MS = 3000;

/**
 * One instance per connected Google account. Once started, it repeatedly
 * asks "which of my broadcasts are live right now" and keeps a chat poller
 * running for each one it finds - no video ID entry needed, matching the
 * "just log in" flow.
 */
class YoutubeAccountManager {
  constructor(account, { onMessage, onTokensRefreshed, onBroadcastsChanged, clientId, clientSecret, redirectUri }) {
    this.account = account; // { id, label, tokens }
    this.onMessage = onMessage;
    this.onTokensRefreshed = onTokensRefreshed;
    this.onBroadcastsChanged = onBroadcastsChanged;

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    this.oauth2Client.setCredentials(account.tokens);
    this.oauth2Client.on("tokens", (tokens) => {
      // refresh_token is only sent once at consent time; googleapis merges
      // automatically in-memory, but we still need to persist the new
      // access_token/expiry ourselves.
      this.onTokensRefreshed(this.account.id, tokens);
    });

    this.youtube = google.youtube({ version: "v3", auth: this.oauth2Client });
    this.chatPollers = new Map(); // broadcastId -> { cancelled, timeout }
    this.stopped = false;
    this.discoveryTimeout = null;
  }

  start() {
    this.stopped = false;
    this._discoverLoop();
  }

  stop() {
    this.stopped = true;
    if (this.discoveryTimeout) clearTimeout(this.discoveryTimeout);
    for (const [id] of this.chatPollers) this._stopChat(id);
  }

  async _discoverLoop() {
    if (this.stopped) return;
    try {
      const res = await this.youtube.liveBroadcasts.list({
        part: ["snippet"],
        broadcastStatus: "active",
        broadcastType: "all",
        mine: true,
      });

      const live = res.data.items || [];
      const liveIds = new Set(live.map((b) => b.id));

      // stop chats for broadcasts that ended
      for (const trackedId of this.chatPollers.keys()) {
        if (!liveIds.has(trackedId)) this._stopChat(trackedId);
      }

      // start chats for newly-live broadcasts
      for (const b of live) {
        if (this.chatPollers.has(b.id)) continue;
        const liveChatId = b.snippet?.liveChatId;
        if (!liveChatId) continue;
        const label =
          live.length > 1 ? `${this.account.label} - ${b.snippet.title}` : this.account.label;
        this._startChat(b.id, liveChatId, label);
      }

      this.onBroadcastsChanged();
    } catch (err) {
      console.error(`[youtube:${this.account.label}] discovery error:`, err.message);
    }

    if (!this.stopped) {
      this.discoveryTimeout = setTimeout(() => this._discoverLoop(), DISCOVERY_INTERVAL_MS);
    }
  }

  _startChat(broadcastId, liveChatId, label) {
    const state = { cancelled: false, label };
    this.chatPollers.set(broadcastId, state);
    console.log(`[youtube:${this.account.label}] live broadcast detected: ${label}`);

    let pageToken = undefined;
    let seen = new Set();

    const poll = async () => {
      if (state.cancelled) return;
      try {
        const res = await this.youtube.liveChatMessages.list({
          liveChatId,
          part: ["snippet", "authorDetails"],
          pageToken,
        });
        pageToken = res.data.nextPageToken;

        for (const item of res.data.items || []) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          this.onMessage({
            platform: "youtube",
            sourceId: `youtube:auto:${broadcastId}`,
            source: label,
            id: item.id,
            author: item.authorDetails.displayName,
            color: null,
            isMod: !!item.authorDetails.isChatModerator,
            isSub: !!item.authorDetails.isChatSponsor,
            message: item.snippet.displayMessage || "",
            timestamp: Date.parse(item.snippet.publishedAt) || Date.now(),
          });
        }

        if (seen.size > 5000) seen = new Set(Array.from(seen).slice(-2000));
        if (state.cancelled) return;

        const nextDelay = Math.max(res.data.pollingIntervalMillis || MIN_POLL_MS, MIN_POLL_MS);
        state.timeout = setTimeout(poll, nextDelay);
      } catch (err) {
        console.error(`[youtube:${label}] chat poll error:`, err.message);
        if (state.cancelled) return;
        state.timeout = setTimeout(poll, Math.max(MIN_POLL_MS * 3, 10000));
      }
    };

    poll();
  }

  _stopChat(broadcastId) {
    const state = this.chatPollers.get(broadcastId);
    if (!state) return;
    state.cancelled = true;
    if (state.timeout) clearTimeout(state.timeout);
    this.chatPollers.delete(broadcastId);
  }

  /** Currently-live sources this account is contributing, for the filter bar. */
  activeSources() {
    return Array.from(this.chatPollers.entries()).map(([broadcastId, state]) => ({
      id: `youtube:auto:${broadcastId}`,
      label: state.label,
      platform: "youtube",
    }));
  }
}

module.exports = { YoutubeAccountManager };
