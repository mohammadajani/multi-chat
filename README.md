# multichat-tts

Merges Twitch + multiple YouTube channels + Kick chat into one feed (viewable
in the terminal, a browser dashboard, and an OBS overlay), and optionally
relays messages to Speaker.bot (via Streamer.bot) for TTS.

Works around Streamer.bot's own limitation of one Twitch + one YouTube
connection at a time, since this reads chat independently of Streamer.bot
and only touches it at the very last step (to trigger the Speak sub-action).

## 1. Install

```bash
python3 -m venv venv
source venv/bin/activate   # venv\Scripts\activate on Windows
pip install -r requirements.txt
cp config.example.json config.json   # Windows: copy config.example.json config.json
python main.py
```

## 2. The dashboard

Open **http://127.0.0.1:8765**. You shouldn't need to hand-edit
`config.json` at all after this — the dashboard reads and writes it for
you. Three tabs:

- **Live Chat** — every message from every connected platform, color-coded,
  with a filter bar (All / one platform / one specific channel) and a TTS
  on/off switch + "Send test TTS" button.
- **Overlay** — builds the URL for an OBS Browser Source, with a live
  preview and a custom-theme editor. See "Chat overlay for OBS" below.
- **Setup** — add/remove channels, YouTube API key, Streamer.bot
  connection, TTS behavior. Everything here now applies **live** — adding a
  channel, removing one, editing an ID/slug, flipping a channel's on/off
  switch, changing Streamer.bot's host/port/action, toggling TTS — none of
  it needs a restart anymore. Save the form and it takes effect within a
  second or two.

### Fields

**Twitch** — just needs your channel name(s). No token needed; this connects
read-only/anonymously, so it can't post to chat, only listen.

**YouTube** — needs a free API key:
1. Go to console.cloud.google.com, create/select a project.
2. Enable the "YouTube Data API v3".
3. Create an API key under Credentials.
4. For each channel, get its Channel ID (Advanced settings on the channel,
   or via https://www.youtube.com/account_advanced when logged into that
   channel).

Each channel is polled independently, so two (or more) YouTube channels
works fine — this is exactly the part Streamer.bot can't do. Checking who's
live costs YouTube API quota (100 units, done once per stream start), then
reading chat is cheap and polls on YouTube's own recommended interval.

**If a channel has two broadcasts live at once** (e.g. a real stream running
alongside a scheduled Premiere), the search that finds "the" live video
picks whichever one started most recently. That's a guess, and it can guess
wrong. If you know a channel will have two simultaneous broadcasts and want
a specific one, set `"video_id"` directly for that channel instead of
`"channel_id"` — that skips the guesswork and points straight at the right
chat.

**Kick** — just needs your channel slug (the name in your kick.com URL).
Kick has no official real-time chat API, so this connects to the same
public Pusher socket kick.com's own site uses. It requires no login, but
it's unofficial and can break if Kick changes their frontend — treat Kick
as best-effort, and check the terminal output if it doesn't connect.

## Why you don't see the whole backlog anymore

YouTube's chat API has a quirk: the very first request for a live chat
returns whatever's already buffered — up to 500 messages by default,
regardless of how long the stream's been running. Left alone, that means
every time this script (re)connects to a channel, it'd dump a wall of old
messages into your feed (and, worse, into TTS) before anything new even
happens. The fix: the first response is fetched only to get a starting
position, and thrown away without displaying or speaking any of it — so
reconnecting now shows you new chat right away instead of replaying
everything you already saw.

## Filtering the live view

The chip bar above the chat log works like Streamer.bot's own chat
filters: **All**, one chip per platform ("Twitch only", "YouTube only",
"Kick only"), and one chip per specific channel (e.g. "YT-Main" on its
own, without YT-Alt or Twitch mixed in). Click a chip to switch — it's
exclusive, one filter active at a time. Messages keep arriving from every
connected source in the background regardless of the filter; switching
just changes what's currently displayed, including scrolling back through
messages you've already received.

## Keeping chat history across a page refresh

By default, refreshing the Live Chat tab clears it — same as before. The
**Keep history on refresh** switch next to the TTS toggle changes that: turn
it on and the page remembers your preference (in the browser, via
localStorage) and asks the server to replay its last ~300 messages every
time it (re)connects, including right after a refresh. The server keeps
that small rolling buffer going in the background regardless of whether
anyone's watching, so it's ready the instant a page connects. This is also
what makes a second device (see below) show the same chat instead of
starting blank.

The overlay intentionally does **not** do this by default — replaying old
messages into an OBS source would also replay their notification sounds,
which gets noisy fast on every reload. If you want it anyway, add
`&replay=1` to the overlay URL by hand; backlogged messages will appear
silently (no sound) so at least your speakers don't get spammed.

## Access from another device (phone, tablet)

By default the dashboard only listens on this PC (`127.0.0.1`), so nothing
else on your network can reach it — a phone trying to open it would just
fail to connect, even on the same WiFi. To let a second device see the
same live chat: Setup tab → **Network access** → check "Allow other
devices on your network to open this dashboard" → Save → **restart the
script** (this one setting needs it, since it means re-binding the actual
network socket, unlike everything else on this page).

Once it's back up, the Network access section shows the address(es) to
type into the other device's browser — something like
`http://192.168.1.23:8765`. Both PC and phone need to be on the same
network for this to work (same WiFi, or same router). With "Keep history
on refresh" turned on too, the phone will show the same recent messages
the PC does, not an empty page.

**Security note:** turning this on exposes the *whole* dashboard to
anyone else on that network — not just the chat view, but your YouTube
API key, the ability to add/remove channels, toggle TTS, all of it.
There's no login/password on this (deliberately kept simple for a
single-user local tool), so only enable it on a network you actually
trust, like your own home WiFi — never on public or shared WiFi. Turn it
back off (and restart) when you don't need it anymore.

## Pausing a channel

Each row in Setup has its own on/off switch, live — no restart. Flipping
it off cancels that channel's connection immediately: no more IRC/websocket
traffic, and for YouTube specifically, no more of the "is this live yet?"
polling every 60 seconds. Flip it back on and it reconnects right away.
This is saved to `config.json` automatically, so a paused channel stays
paused next time you start the script too.

## 3. Set up the Streamer.bot side (only needed for TTS)

1. In Streamer.bot: **Actions** → add a new action, e.g. `Multichat TTS`.
2. Add a sub-action: **Core → Speak.bot → Speak**, and set its Message
   field to `%message%`.
3. In **Servers/Clients → HTTP Server**, make sure the server is
   **enabled**, and note the port (defaults to 7474).
4. Make sure Streamer.bot is actually connected to Speaker.bot too — in
   Speaker.bot, **Settings → WebSocket Server** should be running, and in
   Streamer.bot, **Servers/Clients** should show a WebSocket *Client*
   connection to Speaker.bot as connected. The Speak sub-action added in
   step 2 does nothing if this link is down.
5. In the dashboard's Setup tab, fill in the Streamer.bot host/port and set
   Action name to match the action from step 1 exactly (or use Action ID
   with its GUID instead — right-click the action → Copy GUID). Save.

### If TTS isn't working, narrow it down in order:

1. **Setup tab → Test connection.** This only checks that *something* is
   listening on that host:port — i.e. Streamer.bot's HTTP server is on and
   reachable at all. If this fails, it's the host/port or the HTTP server
   toggle in Streamer.bot, nothing to do with actions or Speaker.bot yet.
2. **Live Chat tab → Send test TTS.** This actually calls `DoAction` with
   your configured action name/ID. If step 1 passed but this fails or you
   hear nothing, the problem is the action itself — check the action name
   is spelled exactly the same in both places (or switch to Action ID),
   and that the action really has a Speak sub-action in it.
3. **Still silent?** Trigger the same action manually from inside
   Streamer.bot (right-click it → Run Now). If that's also silent, the
   issue is entirely inside Streamer.bot/Speaker.bot (the WebSocket link
   between them, or Speaker.bot's own voice/output device settings) and
   has nothing to do with this script — Speaker.bot's own "Test Voice"
   button is the next place to check.

If `tts.enabled` is off, none of this is needed — the script just displays
chat, no TTS involved.

## 4. Run

```bash
python main.py
```

Keep that terminal window open (it still prints chat too) and use
http://127.0.0.1:8765 in your browser for everything else.

## Tuning what gets spoken

Easiest via the Setup page's TTS section:
- `"mode": "all"` speaks everything (minus `!commands`, if `skip_commands`
  is true); `"mode": "prefix"` only speaks messages starting with
  `"prefix"` (e.g. `!tts hello` → speaks "hello"). Prefix mode is the
  safer option once a chat gets busy.
- `max_per_10s` caps how many messages get sent to Speaker.bot in any
  10-second window, so a flood of chat doesn't queue up dozens of TTS
  lines.

## Chat overlay for OBS

Open the **Overlay** tab. It builds a URL like:

```
http://127.0.0.1:8765/overlay?sound=1&volume=0.4&max=6&duration=12&platform=all
```

Controls: sound on/off, volume, how many messages stay on screen at once,
how long each one lingers before fading out (0 = stays until pushed off by
newer ones), and an optional filter down to one platform or one specific
channel. Hit **Copy**, then in OBS: **Sources → + → Browser Source**,
paste the URL in, set a width/height (roughly 420×600 works well, resize
to taste). Background is transparent. The notification sound is generated
in the page itself, no audio file involved, so it works with no internet.

The tab also shows a live preview (checkerboard = transparent) and a
**Send test message** button so you can see it animate and hear the sound
before going live.

If OBS stays silent: OBS's Browser Source sometimes mutes audio unless you
check "Control audio via OBS" in its properties (or leave it unchecked,
depending on your OBS version). Pasting the same URL into a normal browser
tab first is a quick way to confirm the sound itself works, isolating it
to an OBS setting rather than the script.

### Custom theme

By default the overlay uses a built-in dark-card look. To change it: in
the Overlay tab, check **Use custom CSS**, and write your own rules in the
box below it. It reaches an overlay already open in OBS within ~10
seconds — no need to remove and re-add the Browser Source. Turn the
checkbox back off any time to go back to the default look, which stays
available even while a custom theme is saved.

Selectors to target: `#stack` (the container), `.msg` (each message card),
`.badge` / `.badge.twitch` / `.badge.youtube` / `.badge.kick` (the
platform tag), `.user`, `.text`. Redefine `@keyframes slideIn` (entry) or
`@keyframes fadeOut` (exit, used when a message's lifetime runs out) to
change the animation itself — e.g. a scale-in instead of a slide-in, or a
spin, or whatever fits your stream's look.

## Notes / known limits

- This is read-only for all three platforms — it doesn't post messages
  back, only displays and relays them.
- Twitch's anonymous connection can rate-limit or occasionally disconnect
  under heavy load; it auto-reconnects with backoff.
- If a YouTube channel isn't live yet, that source just waits and retries
  every 60s, without spending any quota beyond that check.

## Memory footprint

This is designed to stay light-weight indefinitely, not just at startup:
- Nothing is logged to a growing file by default. The one piece of state
  kept in memory on purpose is the small rolling history buffer (see
  "Keeping chat history across a page refresh") — capped at 300 messages,
  a few hundred KB at most, overwriting itself as new messages arrive
  rather than growing.
- The dashboard caps how much it keeps in the browser too: its in-memory
  history (used so filter switches can redraw) is capped at 300 messages,
  same as the server buffer, and the DOM itself never holds more chat
  lines than that either. The overlay keeps no history at all by default —
  just whatever's currently on screen (`max` messages, a handful).
- YouTube polling asks for the smallest page size the API allows (200
  rather than the 500 default), since the first page is discarded anyway
  and every page after that is smaller to download and parse.
- A paused channel (see "Pausing a channel") uses no memory or CPU beyond
  the small config entry recording that it's off.

## Building a portable .exe (Windows)

`build_exe.bat` bundles everything (Python interpreter included) into one
`multichat.exe` using PyInstaller, so it can run on a Windows PC with no
Python installation at all.

**This has to be built on Windows** — a .exe is tied to the OS it's built
on, so this can't be produced from anywhere else (including by me, since I
don't have a Windows machine to build it on). What you get from me is the
source plus a script that does the packaging in one step:

1. Install Python from python.org if you don't have it (check "Add to
   PATH" during install).
2. Unzip this project, open a terminal in that folder.
3. Run `build_exe.bat`. It creates a throwaway virtual environment,
   installs the dependencies plus PyInstaller into it, and builds the exe
   — this step needs internet access and takes a few minutes.
4. Find `multichat.exe` in the new `dist` folder. That one file is
   portable — copy it anywhere (another PC, a USB stick) and it runs with
   no setup.

The exe keeps a console window open when you run it (same chat printout
as running the script normally) — that's intentional, not a bug. The
first time it runs, it creates its own `config.json` right next to
itself; open the dashboard to fill it in, same as the script version. If
you rebuild after making changes, just re-run `build_exe.bat` — it'll
overwrite the old `dist\multichat.exe`.
