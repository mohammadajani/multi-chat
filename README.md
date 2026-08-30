# Multichat

One dashboard, merged chat from any number of Twitch channels + YouTube live
broadcasts — including both destinations of a native YouTube dual-stream,
since each destination is still its own broadcast with its own live chat.

## Setup

```bash
npm install
cp config.example.js config.js
```

Edit `config.js`:

- `twitchChannels`: list every Twitch channel login you want chat from. No
  login/token needed — reading public chat works fully anonymously.
- `youtubeApiKey`: a free YouTube Data API v3 key (Google Cloud Console →
  enable "YouTube Data API v3" → Credentials → Create API key). No OAuth
  needed to *read* a public broadcast's chat.
- `youtubeStreams`: one entry per YouTube broadcast — this is what covers
  your two separate YouTube accounts, and separately covers YouTube's
  dual-stream feature (add one entry per destination). Get `videoId` from
  each broadcast's watch URL.

## Run

```bash
npm start
```

Then open `http://localhost:4545` in a browser tab, or add it as an OBS
**Browser Source** (same pointing-a-URL-at-OBS pattern as your superchat
overlay) if you want it visible on stream or on a second monitor.

## Notes

- Each source gets its own filter chip at the top — click to toggle it off
  without losing the merged view.
- Twitch is a live websocket (instant). YouTube is polled — the script
  respects YouTube's own suggested polling interval per response so you
  won't burn through the API's free daily quota (10,000 units/day; each poll
  costs ~5 units).
- If a YouTube entry logs "No active live chat found," that broadcast isn't
  live yet or its `videoId` is wrong — everything else keeps running.
- Nothing here posts messages, only reads — so no risk to your accounts,
  and no OAuth/login step for either platform.
