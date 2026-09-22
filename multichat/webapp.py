import asyncio
import json
from pathlib import Path

import aiohttp
from aiohttp import web

from .channels import ChannelManager
from .models import ChatMessage
from .streamerbot import StreamerBotRelay


class Hub:
    """Shared, live-mutable state between the background chat readers and the
    local web UI: the TtsFilter instance (so the browser toggle takes effect
    immediately), the relay (for the "test TTS" button), the ChannelManager
    (so per-channel on/off switches take effect immediately), and the set of
    connected browser sockets to broadcast chat lines to."""

    def __init__(self, config_path: str, tts_filter, relay: StreamerBotRelay | None,
                 manager: ChannelManager):
        self.config_path = Path(config_path)
        self.tts_filter = tts_filter
        self.relay = relay
        self.manager = manager
        self._clients: set[web.WebSocketResponse] = set()

    def load_config(self) -> dict:
        with open(self.config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_config(self, data: dict):
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def persist_channel_enabled(self, key: str, enabled: bool):
        """Writes a single channel's enabled flag back into config.json, so a
        temporary off-switch survives a restart too."""
        try:
            cfg = self.load_config()
        except FileNotFoundError:
            return
        platform = key.split(":", 1)[0]
        for c in cfg.get(platform, {}).get("channels", []):
            try:
                if ChannelManager.key_for(platform, c) == key:
                    c["enabled"] = enabled
                    break
            except (KeyError, ValueError):
                continue
        self.save_config(cfg)

    async def broadcast(self, msg: ChatMessage):
        if not self._clients:
            return
        payload = json.dumps({
            "platform": msg.platform,
            "channel": msg.channel,
            "username": msg.username,
            "text": msg.clean_text(),
            "ts": msg.ts,
        })
        dead = []
        for ws in self._clients:
            try:
                await ws.send_str(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


def build_app(hub: Hub) -> web.Application:
    app = web.Application()
    index_path = Path(__file__).parent / "web" / "index.html"
    overlay_path = Path(__file__).parent / "web" / "overlay.html"

    async def index(request):
        return web.FileResponse(index_path)

    async def overlay(request):
        return web.FileResponse(overlay_path)

    async def get_config(request):
        try:
            return web.json_response(hub.load_config())
        except FileNotFoundError:
            return web.json_response({"error": "config.json not found next to main.py"}, status=404)

    async def save_config(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "invalid JSON body"}, status=400)
        try:
            hub.save_config(data)
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)

        # TTS behavior can apply live since consume() reads these off the same
        # TtsFilter instance every message. Adding/removing channels, editing
        # a channel's id/slug, or Streamer.bot connection details still need
        # a restart -- only the per-channel enable/disable switch is live,
        # via /api/channel-toggle below.
        tts_cfg = data.get("tts", {})
        for field in ("enabled", "mode", "prefix", "skip_commands", "min_length", "max_length", "max_per_10s"):
            if field in tts_cfg:
                setattr(hub.tts_filter, field, tts_cfg[field])

        return web.json_response({
            "ok": True,
            "note": "Saved. TTS behavior applies immediately.\n"
                    "Adding/removing channels or editing Streamer.bot connection details "
                    "still needs a restart (stop with Ctrl+C, run again). Per-channel "
                    "on/off switches apply immediately, no restart needed.",
        })

    async def tts_toggle(request):
        data = await request.json()
        hub.tts_filter.enabled = bool(data.get("enabled", False))
        return web.json_response({"enabled": hub.tts_filter.enabled})

    async def tts_test(request):
        if hub.relay is None:
            return web.json_response(
                {"error": "TTS relay isn't set up yet -- fill in Streamer.bot fields, "
                          "enable TTS, save, and restart the script first"},
                status=400,
            )
        async with aiohttp.ClientSession() as session:
            ok = await hub.relay.speak(session, "Multichat", "This is a test message from multichat T T S.", "test")
        return web.json_response({"ok": ok})

    async def test_message(request):
        # Lets the Overlay/Setup pages show a real message flowing through the
        # pipeline (and animate the overlay) without waiting for live chat.
        msg = ChatMessage(platform="twitch", channel="Test", username="Multichat",
                           text="This is a test message -- your overlay is working!")
        await hub.broadcast(msg)
        return web.json_response({"ok": True})

    async def list_channels(request):
        return web.json_response(hub.manager.status())

    async def channel_toggle(request):
        data = await request.json()
        key = data.get("key")
        enabled = bool(data.get("enabled", True))
        if not key or not hub.manager.set_enabled(key, enabled):
            return web.json_response({"error": f"unknown channel key: {key}"}, status=404)
        hub.persist_channel_enabled(key, enabled)
        return web.json_response({"key": key, "enabled": enabled})

    async def ws_handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        hub._clients.add(ws)
        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.ERROR:
                    break
        finally:
            hub._clients.discard(ws)
        return ws

    app.router.add_get("/", index)
    app.router.add_get("/overlay", overlay)
    app.router.add_get("/api/config", get_config)
    app.router.add_post("/api/config", save_config)
    app.router.add_post("/api/tts-toggle", tts_toggle)
    app.router.add_post("/api/tts-test", tts_test)
    app.router.add_post("/api/test-message", test_message)
    app.router.add_get("/api/channels", list_channels)
    app.router.add_post("/api/channel-toggle", channel_toggle)
    app.router.add_get("/ws", ws_handler)
    return app


async def run_webui(hub: Hub, host: str, port: int):
    app = build_app(hub)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    print(f"[webui] open http://{host}:{port} for setup + the live chat page")
    print(f"[webui] overlay URL for OBS: http://{host}:{port}/overlay (customize it from the Overlay tab)")
    while True:
        await asyncio.sleep(3600)
