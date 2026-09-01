# Multichat

One dashboard, merged chat from any number of Twitch channels + YouTube live
broadcasts — including friends' channels, both your YouTube accounts, and
every destination of a native YouTube dual-stream (each destination is still
its own broadcast with its own chat).

Everything is managed from an in-app **Settings** panel (gear icon) — no
config file editing required. Accounts can be added or removed while the
server is running.

## Setup

```bash
npm install
npm start
```

Open `http://localhost:4545`, click the gear icon, and:

1. Paste a free **YouTube API key** (Google Cloud Console → enable "YouTube
   Data API v3" → Credentials → Create API key). One key covers all your
   YouTube sources — no OAuth/login needed to read a public chat.
2. Add **Twitch channels** — just the channel login (e.g. `ninja`), plus an
   optional label like "Twitch 1" or a friend's name. No Twitch login needed
   to read chat.
3. Add **YouTube streams** — one entry per broadcast, using the `videoId`
   from its watch URL (`youtube.com/watch?v=XXXXXXXXXXX`). Add one entry per
   dual-stream destination, and one per separate YouTube account.

Settings are saved to `db.json` in the project folder and reloaded
automatically on restart — no need to re-enter anything.

## Filters

- **All / Twitch Only / YouTube Only** — group-level toggle at the top.
- **Per-account chips** — one per Twitch channel and YouTube stream you've
  added (e.g. "Twitch 1", "Twitch 2", "YouTube 1", "YouTube 2", or whatever
  labels you gave them). Click to mute just that one without losing the rest.

Both filter levels combine — e.g. "Twitch Only" plus muting "Twitch 2" shows
only Twitch 1's chat.

## Notes

- Twitch is a live websocket (instant, via `tmi.js`). YouTube is polled,
  respecting YouTube's own suggested interval so you won't burn the free
  10,000-units/day quota (~5 units per poll).
- Add it as an OBS **Browser Source** if you want the merged feed visible on
  stream or on a second monitor — same URL, same page.
- Nothing here posts messages, only reads — no risk to any account, and no
  OAuth/login step for either platform.
- If a YouTube entry doesn't produce chat, it usually means that broadcast
  isn't live yet — everything else keeps running independently.
