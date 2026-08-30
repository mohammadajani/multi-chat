const { google } = require("googleapis");

const youtube = google.youtube("v3");

/**
 * Resolves a watch-page videoId to its active liveChatId.
 */
async function resolveLiveChatId(apiKey, videoId) {
  const res = await youtube.videos.list({
    key: apiKey,
    part: ["liveStreamingDetails"],
    id: [videoId],
  });

  const video = res.data.items && res.data.items[0];
  const liveChatId = video?.liveStreamingDetails?.activeLiveChatId;

  if (!liveChatId) {
    throw new Error(
      `No active live chat found for video ${videoId}. Is it currently live?`
    );
  }
  return liveChatId;
}

/**
 * Polls one YouTube live chat on a loop, respecting YouTube's own suggested
 * polling interval (never polling faster than that, or faster than minPollMs).
 *
 * @param {string} apiKey
 * @param {{label: string, videoId: string}} stream
 * @param {number} minPollMs
 * @param {(msg: object) => void} onMessage
 */
async function pollYoutubeStream(apiKey, stream, minPollMs, onMessage) {
  let liveChatId;
  try {
    liveChatId = await resolveLiveChatId(apiKey, stream.videoId);
  } catch (err) {
    console.error(`[youtube:${stream.label}] ${err.message}`);
    return; // give up on this one stream, others keep running
  }

  console.log(`[youtube:${stream.label}] chat resolved, polling started`);

  let pageToken = undefined;
  let seen = new Set();

  const poll = async () => {
    try {
      const res = await youtube.liveChatMessages.list({
        key: apiKey,
        liveChatId,
        part: ["snippet", "authorDetails"],
        pageToken,
      });

      pageToken = res.data.nextPageToken;

      for (const item of res.data.items || []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);

        onMessage({
          platform: "youtube",
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

      // cap memory - we only need de-dupe over a recent window
      if (seen.size > 5000) {
        seen = new Set(Array.from(seen).slice(-2000));
      }

      const nextDelay = Math.max(
        res.data.pollingIntervalMillis || minPollMs,
        minPollMs
      );
      setTimeout(poll, nextDelay);
    } catch (err) {
      console.error(`[youtube:${stream.label}] poll error:`, err.message);
      // back off and retry rather than dying - stream could recover
      setTimeout(poll, Math.max(minPollMs * 3, 10000));
    }
  };

  poll();
}

/**
 * Starts pollers for every configured YouTube stream (covers both separate
 * accounts and every destination of a native dual/multi-stream, since each
 * still has its own videoId + liveChatId).
 */
function startYoutubeChats(apiKey, streams, minPollMs, onMessage) {
  if (!streams || streams.length === 0) {
    console.log("[youtube] no streams configured, skipping");
    return;
  }
  for (const stream of streams) {
    pollYoutubeStream(apiKey, stream, minPollMs, onMessage);
  }
}

module.exports = { startYoutubeChats };
