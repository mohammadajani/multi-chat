const { google } = require("googleapis");

const youtube = google.youtube("v3");

async function resolveLiveChatId(apiKey, videoId) {
  const res = await youtube.videos.list({
    key: apiKey,
    part: ["liveStreamingDetails"],
    id: [videoId],
  });
  const video = res.data.items && res.data.items[0];
  const liveChatId = video?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) {
    throw new Error(`no active live chat for video ${videoId} (is it live?)`);
  }
  return liveChatId;
}

/**
 * Manages any number of independently pollable YouTube live chats, each
 * stoppable/startable at runtime by id (so Settings can add/remove accounts
 * or dual-stream destinations without restarting the app).
 */
class YoutubeManager {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.pollers = new Map(); // id -> { cancelled }
    this.apiKey = "";
    this.minPollMs = 3000;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  setMinPollMs(ms) {
    this.minPollMs = ms;
  }

  start(streams) {
    for (const s of streams) this.addStream(s);
  }

  async addStream(stream) {
    // stream: { id, videoId, label }
    if (!this.apiKey) {
      console.error(`[youtube:${stream.label}] no API key configured yet`);
      return;
    }
    if (this.pollers.has(stream.id)) return;
    const state = { cancelled: false };
    this.pollers.set(stream.id, state);

    let liveChatId;
    try {
      liveChatId = await resolveLiveChatId(this.apiKey, stream.videoId);
    } catch (err) {
      console.error(`[youtube:${stream.label}] ${err.message}`);
      return;
    }

    console.log(`[youtube:${stream.label}] chat resolved, polling started`);
    let pageToken = undefined;
    let seen = new Set();

    const poll = async () => {
      if (state.cancelled) return;
      try {
        const res = await youtube.liveChatMessages.list({
          key: this.apiKey,
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
            sourceId: `youtube:${stream.id}`,
            source: stream.label,
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
        const nextDelay = Math.max(
          res.data.pollingIntervalMillis || this.minPollMs,
          this.minPollMs
        );
        state.timeout = setTimeout(poll, nextDelay);
      } catch (err) {
        console.error(`[youtube:${stream.label}] poll error:`, err.message);
        if (state.cancelled) return;
        state.timeout = setTimeout(poll, Math.max(this.minPollMs * 3, 10000));
      }
    };

    poll();
  }

  removeStream(id) {
    const state = this.pollers.get(id);
    if (!state) return;
    state.cancelled = true;
    if (state.timeout) clearTimeout(state.timeout);
    this.pollers.delete(id);
  }
}

module.exports = { YoutubeManager };
