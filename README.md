# multichat-tts

Merges Twitch + multiple YouTube channels + Kick chat into one terminal feed,
and optionally relays messages to Speaker.bot (via Streamer.bot) for TTS.

Works around Streamer.bot's own limitation of one Twitch + one YouTube
connection at a time, since this reads chat independently of Streamer.bot
and only touches it at the very last step (to trigger the Speak sub-action).

## 1. Install

```bash
python3 -m venv venv
source venv/bin/activate   # venv\Scripts\activate on Windows
pip install -r requirements.txt
cp config.example.json config.json
```

## 2. First run + the setup page

You need *a* `config.json` to exist before `main.py` will start — copy the
example once:

```bash
cp config.example.json config.json   # Windows: copy config.example.json config.json
python main.py
```

Then open **http://127.0.0.1:8765** in your browser. That's the whole point
of this page — you shouldn't need to hand-edit the JSON file at all after
this. It has two tabs:

- **Setup** — add/remove Twitch, YouTube, and Kick channels with a form
  (+ Add buttons, Remove buttons), fill in your YouTube API key and
  Streamer.bot connection details, tune TTS behavior, and hit **Save
  config**. It writes straight back to `config.json` for you. Each channel
  row also has an on/off switch — see "Pausing a channel" below.
- **Live Chat** — every message from all connected platforms streams in
  here live, color-coded by platform, plus a filter bar (All / a platform
  only / one specific channel only) so chats don't blend together, a TTS
  on/off switch, and a "Send test TTS" button so you can check Speaker.bot
  is wired up without waiting for chat activity.

Fields:

**Twitch** — just needs your channel name(s). No token needed; this connects
read-only/anonymously, so it can't post to chat, only listen.

**YouTube** — needs a free API key:
1. Go to console.cloud.google.com, create/select a project.
2. Enable the "YouTube Data API v3".
3. Create an API key under Credentials.
4. For each channel, get its Channel ID (Advanced settings on the channel,
   or via https://www.youtube.com/account_advanced when logged into that
   channel).

Each channel is polled independently, so two YouTube channels works fine —
this is exactly the part Streamer.bot can't do. Checking who's live costs
YouTube API quota (100 units, done once per stream start), then reading
chat is cheap and polls on YouTube's own recommended interval.

**Kick** — just needs your channel slug (the name in your kick.com URL).
Kick has no official real-time chat API, so this connects to the same
public Pusher socket kick.com's own site uses. It requires no login, but
it's unofficial and can break if Kick changes their frontend — treat Kick
as best-effort, and check the terminal output if it doesn't connect.

**One thing the page can't do:** adding, removing, or editing a channel's
id/slug, or editing the Streamer.bot connection, needs a restart to take
effect (stop with Ctrl+C, run `python main.py` again) — those connections
are only opened at startup. TTS behavior (on/off, mode, prefix, limits)
applies immediately, no restart needed.

## Filtering the live view

The chip bar above the chat log works like Streamer.bot's own chat
filters: **All**, one chip per platform ("Twitch only", "YouTube only",
"Kick only"), and one chip per specific channel (e.g. "YT-Main" on its
own, without YT-Alt or Twitch mixed in). Click a chip to switch — it's
exclusive, one filter active at a time, so picking a specific channel
shows only that channel's messages. Messages keep arriving from every
connected source in the background regardless of the filter; switching
just changes what's currently displayed, including scrolling back through
messages you've already received.

## Pausing a channel

Each row in Setup has its own on/off switch. For a channel that's already
running, flipping it off cancels that channel's connection immediately —
no more IRC/websocket traffic, and for YouTube specifically, no more of
the "is this live yet?" polling every 60 seconds — so a channel you're not
using right now costs nothing while it's off. Flip it back on and it
reconnects right away. This is saved to `config.json` automatically, so a
channel you've paused stays paused the next time you start the script too
— no need to remove it and re-add it later.

The switch only acts live for channels the app already knows about (i.e.
it was running when you loaded the page). A brand-new row you just added
will say "after save" — it needs Save + a restart once, and after that its
switch works instantly like the rest.

Tip: since it's just a local webpage, you can also add
`http://127.0.0.1:8765` as an OBS **Browser Source** if you want the live
chat feed visible on stream, not just for your own reference.

## 3. Set up the Streamer.bot side (only needed for TTS)

1. In Streamer.bot: Actions → add a new action, e.g. `Multichat TTS`.
2. Add a sub-action: **Core → Speak.bot → Speak**, and set its Message
   field to `%message%`.
3. In Servers/Clients → HTTP Server, make sure the server is **enabled**,
   and note the port (defaults to 7474).
4. In `config.json`, set `streamerbot.action_name` to match the action
   name exactly (or use `action_id` with the action's GUID instead).

If `tts.enabled` is `false`, none of this is needed — the script will just
print chat to your terminal.

## 4. Run

```bash
python main.py
```

Then keep that terminal window open (it still prints chat too) and use
http://127.0.0.1:8765 in your browser for setup and the live view.

## Tuning what gets spoken

Easiest via the Setup page's TTS section. Under the hood it's `config.json`'s
`"tts"` block:
- `"mode": "all"` speaks everything (minus `!commands`, if `skip_commands`
  is true); `"mode": "prefix"` only speaks messages starting with
  `"prefix"` (e.g. `!tts hello` → speaks "hello"). Prefix mode is the
  safer option once a chat gets busy.
- `max_per_10s` caps how many messages get sent to Speaker.bot in any
  10-second window, so a flood of chat doesn't queue up dozens of TTS
  lines.

## Chat overlay for OBS

Open the **Overlay** tab in the dashboard. It builds a URL like:

```
http://127.0.0.1:8765/overlay?sound=1&volume=0.4&max=6&duration=12&platform=all
```

Controls: sound on/off, volume, how many messages stay on screen at once,
how long each one lingers before fading out (0 = stays until pushed off by
newer ones), and an optional filter down to one platform or one specific
channel — handy if you only want, say, your main YouTube chat on stream
and not everything else.

Hit **Copy**, then in OBS: **Sources → + → Browser Source**, paste the URL
in, and set a width/height (roughly 420×600 works well, but resize to
taste). Background is transparent, so it'll sit over your other sources
without a box around it. The notification sound is generated in the page
itself (no audio file involved), so it works even with no internet.

The Overlay tab also shows a live preview (checkerboard = transparent) and
a **Send test message** button so you can see it animate and hear the
sound before going live.

One thing to know: OBS's Browser Source sometimes mutes audio by default
unless you check the "Control audio via OBS" box in its properties (or
leave it unchecked, depending on your OBS version) — if you copy the URL
into a normal browser tab first, the sound should work immediately there,
which is a quick way to confirm it's not the script's fault if OBS stays
silent.

## Notes / known limits

- This is read-only for all three platforms — it doesn't post messages
  back, only displays and relays them.
- Twitch's anonymous connection can rate-limit or occasionally disconnect
  under heavy load; it auto-reconnects with backoff.
- If a YouTube channel isn't live yet, that source just waits and retries
  every 60s.
