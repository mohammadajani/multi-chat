import asyncio
import json
import socket
import sys
from collections import deque
from pathlib import Path

import aiohttp
from aiohttp import web

from .channels import ChannelManager
from .models import ChatMessage
from .streamerbot import StreamerBotRelay

DEFAULT_OVERLAY_THEME = {"enabled": False, "css": ""}
HISTORY_SIZE = 300  # small, bounded -- see "Memory footprint" in the README


def _bundled_path(relative: str) -> Path:
    """Resolves a path to a bundled file, whether running as a normal script
    or as a PyInstaller-frozen .exe (which unpacks data files under
    sys._MEIPASS/multichat/... per the --add-data mapping in build_exe.bat,
    instead of sitting next to this .py file)."""
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS) / "multichat"
    else:
        base = Path(__file__).parent
    return base / relative


def local_ip_addresses() -> list[str]:
    """Best-effort list of this machine's LAN-reachable IPv4 addresses, so the
    dashboard can tell you what to type into a phone's browser."""
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # doesn't actually send anything
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


class Hub:
    """Shared, live-mutable state between the background chat readers and the
    local web UI: the TtsFilter instance and the relay (both read fresh by
    consume() on every message, so toggling TTS or editing the Streamer.bot
    connection applies immediately -- no restart), the ChannelManager (so
    channel add/remove/on/off all apply immediately too), a small rolling
    history of recent messages (so a page refresh or a newly-connecting
    device can be caught up instead of starting blank), and the set of
    connected browser sockets to broadcast chat lines to."""

    def __init__(self, config_path: str, tts_filter, relay: StreamerBotRelay | None,
                 manager: ChannelManager):
        self.config_path = Path(config_path)
        self.tts_filter = tts_filter
        self.relay = relay
        self.manager = manager
        self._clients: set[web.WebSocketResponse] = set()
        self._history: deque = deque(maxlen=HISTORY_SIZE)
        # Set by run_webui() to the address actually bound at startup, so the
        # UI can tell "saved but needs a restart" apart from "already live".
        self.bound_host = "127.0.0.1"
        self.bound_port = 8765

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

    def apply_streamerbot_settings(self, data: dict):
        """Creates/updates/tears down the relay in place from saved config, so
        Streamer.bot connection details and the TTS on/off switch apply live
        instead of needing a restart."""
        sb_cfg = data.get("streamerbot", {})
        tts_cfg = data.get("tts", {})
        if tts_cfg.get("enabled"):
            if self.relay is None:
                self.relay = StreamerBotRelay(
                    host=sb_cfg.get("host", "127.0.0.1"),
                    port=sb_cfg.get("port", 7474),
                    action_name=sb_cfg.get("action_name"),
                    action_id=sb_cfg.get("action_id"),
                )
            else:
                self.relay.url = f"http://{sb_cfg.get('host', '127.0.0.1')}:{sb_cfg.get('port', 7474)}/DoAction"
                self.relay.action_name = sb_cfg.get("action_name")
                self.relay.action_id = sb_cfg.get("action_id")
        else:
            self.relay = None

    def get_overlay_theme(self) -> dict:
        try:
            cfg = self.load_config()
        except FileNotFoundError:
            return dict(DEFAULT_OVERLAY_THEME)
        theme = cfg.get("overlay_theme", {})
        return {
            "enabled": bool(theme.get("enabled", False)),
            "css": theme.get("css", ""),
        }

    def save_overlay_theme(self, enabled: bool, css: str):
        try:
            cfg = self.load_config()
        except FileNotFoundError:
            cfg = {}
        cfg["overlay_theme"] = {"enabled": enabled, "css": css}
        self.save_config(cfg)

    def history_snapshot(self) -> str:
        return json.dumps({"type": "history", "items": list(self._history)})

    async def broadcast(self, msg: ChatMessage):
        payload = {
            "type": "message",
            "platform": msg.platform,
            "channel": msg.channel,
            "username": msg.username,
            "text": msg.clean_text(),
            "ts": msg.ts,
        }
        # Recorded even with nobody connected right now, so history is ready
        # the moment someone (re)connects.
        self._history.append(payload)
        if not self._clients:
            return
        text_payload = json.dumps(payload)
        dead = []
        for ws in self._clients:
            try:
                await ws.send_str(text_payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


def build_app(hub: Hub) -> web.Application:
    app = web.Application()
    index_path = _bundled_path("web/index.html")
    overlay_path = _bundled_path("web/overlay.html")

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

        tts_cfg = data.get("tts", {})
        for field in ("enabled", "mode", "prefix", "skip_commands", "min_length", "max_length", "max_per_10s"):
            if field in tts_cfg:
                setattr(hub.tts_filter, field, tts_cfg[field])
        hub.apply_streamerbot_settings(data)

        diff = hub.manager.sync(data)
        parts = ["Saved -- channels, Streamer.bot connection, and TTS settings all applied immediately, no restart needed."]
        if diff["added"]:
            parts.append(f"Connected: {', '.join(diff['added'])}.")
        if diff["removed"]:
            parts.append(f"Disconnected: {', '.join(diff['removed'])}.")

        web_cfg = data.get("webui", {})
        wants_host = web_cfg.get("host", hub.bound_host)
        wants_port = web_cfg.get("port", hub.bound_port)
        if wants_host != hub.bound_host or wants_port != hub.bound_port:
            parts.append(f"Network access change needs a restart to take effect "
                          f"(currently listening on {hub.bound_host}:{hub.bound_port}).")

        return web.json_response({"ok": True, "note": " ".join(parts)})

    async def tts_toggle(request):
        data = await request.json()
        hub.tts_filter.enabled = bool(data.get("enabled", False))
        return web.json_response({"enabled": hub.tts_filter.enabled})

    async def tts_test(request):
        if hub.relay is None:
            return web.json_response(
                {"error": "TTS relay isn't set up yet -- fill in Streamer.bot fields, "
                          "enable TTS, and save (no restart needed)"},
                status=400,
            )
        async with aiohttp.ClientSession() as session:
            ok = await hub.relay.speak(session, "Multichat", "This is a test message from multichat T T S.", "test")
        return web.json_response({"ok": ok})

    async def streamerbot_ping(request):
        try:
            cfg = hub.load_config()
        except FileNotFoundError:
            return web.json_response({"error": "config.json not found"}, status=404)
        sb_cfg = cfg.get("streamerbot", {})
        host = sb_cfg.get("host", "127.0.0.1")
        port = sb_cfg.get("port", 7474)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"http://{host}:{port}/", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                    # Any HTTP response at all -- even a 404 -- means something
                    # is listening on that host:port, i.e. Streamer.bot's HTTP
                    # server is reachable. That's a different question from
                    # whether the Action/sub-action is set up right, which
                    # "Send test TTS" checks instead.
                    return web.json_response({"reachable": True, "status": resp.status})
        except Exception as exc:
            return web.json_response({"reachable": False, "error": str(exc)})

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

    async def get_overlay_theme(request):
        return web.json_response(hub.get_overlay_theme())

    async def save_overlay_theme(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "invalid JSON body"}, status=400)
        hub.save_overlay_theme(bool(data.get("enabled", False)), data.get("css", ""))
        return web.json_response({"ok": True})

    async def network_info(request):
        try:
            cfg = hub.load_config()
            web_cfg = cfg.get("webui", {})
        except FileNotFoundError:
            web_cfg = {}
        return web.json_response({
            "bound_host": hub.bound_host,
            "bound_port": hub.bound_port,
            "lan_access_live": hub.bound_host != "127.0.0.1",
            "configured_host": web_cfg.get("host", hub.bound_host),
            "configured_port": web_cfg.get("port", hub.bound_port),
            "local_ips": local_ip_addresses(),
        })

    async def ws_handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        if request.query.get("replay") == "1":
            try:
                await ws.send_str(hub.history_snapshot())
            except Exception:
                pass
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
    app.router.add_get("/api/streamerbot-ping", streamerbot_ping)
    app.router.add_post("/api/test-message", test_message)
    app.router.add_get("/api/channels", list_channels)
    app.router.add_post("/api/channel-toggle", channel_toggle)
    app.router.add_get("/api/overlay-theme", get_overlay_theme)
    app.router.add_post("/api/overlay-theme", save_overlay_theme)
    app.router.add_get("/api/network-info", network_info)
    app.router.add_get("/ws", ws_handler)
    return app


async def run_webui(hub: Hub, host: str, port: int):
    hub.bound_host = host
    hub.bound_port = port
    app = build_app(hub)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    display_host = host if host != "0.0.0.0" else "127.0.0.1"
    print(f"[webui] open http://{display_host}:{port} for setup + the live chat page")
    print(f"[webui] overlay URL for OBS: http://{display_host}:{port}/overlay (customize it from the Overlay tab)")
    if host == "0.0.0.0":
        ips = local_ip_addresses()
        if ips:
            print(f"[webui] LAN access is on -- also reachable at: {', '.join(f'http://{ip}:{port}' for ip in ips)}")
    while True:
        await asyncio.sleep(3600)
