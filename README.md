# Multichat

One dashboard, merged chat from any number of Twitch channels + YouTube
accounts — including friends' channels, both your YouTube accounts, and
every destination of a native YouTube dual-stream.

Everything is managed from an in-app **Settings** panel (gear icon) — no
config file editing required. Accounts can be added or removed while the
server is running.

## Setup

```bash
npm install
npm start
```

Open `http://localhost:4545`, click the gear icon.

### YouTube — Sign in with Google (recommended)

This is the main way to add YouTube: sign in once and it automatically
finds and pulls chat from whatever that account is currently live-streaming
— no video ID needed, and it works with your dual-stream destinations too
since they're tied to the same account/broadcast.

One-time setup (free, ~2 minutes):

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create a project if you don't have one, then enable **"YouTube Data API v3"**
   under APIs & Services → Library.
3. Under APIs & Services → Credentials → **Create Credentials → OAuth client ID**,
   choose **Web application**.
4. Add `http://localhost:4545/auth/google/callback` as an **authorized
   redirect URI** (the Settings panel shows you this exact URL too).
5. Copy the **Client ID** and **Client Secret** into the Settings panel and
   click Save.
6. Click **Sign in with Google**. Repeat this step again anytime to connect
   a second account (your other channel, or a friend's).

### Twitch

Add channels by login name (e.g. `ninja`) — no Twitch login needed to read
public chat, works instantly for any channel including friends'.

### Advanced: manual video ID (optional, no login)

Tucked under "Advanced" in Settings — lets you pull a specific broadcast's
public chat by pasting its video ID, using a free YouTube API key instead of
signing in. Useful as a fallback, or for a broadcast that isn't on an
account you want to fully connect.

## Filters

- **All / Twitch Only / YouTube Only** — group-level toggle at the top.
- **Per-account chips** — one per connected Twitch channel and YouTube
  account/broadcast. Click to mute just that one without losing the rest.

Both filter levels combine — e.g. "YouTube Only" plus muting one account's
chip shows just the other YouTube chat.

## Notes

- Twitch is a live websocket (instant, via `tmi.js`).
- Signed-in YouTube accounts are checked every 30s for newly-live or
  newly-ended broadcasts; their chat is polled at whatever interval YouTube
  itself recommends.
- Settings (including OAuth tokens, stored locally) are saved to `db.json`
  in the project folder and reloaded automatically on restart.
- Add the dashboard as an OBS **Browser Source** if you want the merged feed
  visible on stream or on a second monitor — same URL, same page.
- Nothing here posts messages, only reads chat — no risk to any account.
- Google's own dashboard lets you review or revoke this app's access anytime
  at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
