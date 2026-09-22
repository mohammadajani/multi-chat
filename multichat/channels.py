import asyncio

from .kick_source import start_kick_channel
from .twitch_source import start_twitch_channel
from .youtube_source import start_youtube_channel


class ChannelManager:
    """Registers every configured channel and starts a background task for
    each one that's enabled. Channels can be toggled on/off individually at
    runtime -- turning one off cancels its task (closing the connection and
    stopping any polling), turning it back on starts a fresh task. This is
    what lets a YouTube channel that isn't currently streaming be paused
    without touching the other channels or restarting the app.
    """

    def __init__(self, queue: asyncio.Queue):
        self.queue = queue
        self._tasks: dict[str, asyncio.Task] = {}
        self._configs: dict[str, dict] = {}  # key -> {"platform": ..., **channel_cfg}
        self._youtube_api_key = ""

    @staticmethod
    def key_for(platform: str, cfg: dict) -> str:
        if platform == "twitch":
            return f"twitch:{cfg['channel'].lower()}"
        if platform == "youtube":
            ident = cfg.get("channel_id") or cfg.get("video_id") or cfg.get("label", "?")
            return f"youtube:{ident}"
        if platform == "kick":
            return f"kick:{cfg['slug'].lower()}"
        raise ValueError(f"unknown platform: {platform}")

    def load(self, cfg: dict):
        """Registers every channel from config and starts the enabled ones.
        Call once at startup."""
        self._youtube_api_key = cfg.get("youtube", {}).get("api_key", "")
        for c in cfg.get("twitch", {}).get("channels", []):
            self._register("twitch", c)
        for c in cfg.get("youtube", {}).get("channels", []):
            self._register("youtube", c)
        for c in cfg.get("kick", {}).get("channels", []):
            self._register("kick", c)

    def _register(self, platform: str, cfg: dict):
        try:
            key = self.key_for(platform, cfg)
        except (KeyError, ValueError):
            return
        self._configs[key] = {"platform": platform, **cfg}
        if cfg.get("enabled", True):
            self._start(key)

    def _start(self, key: str):
        existing = self._tasks.get(key)
        if existing and not existing.done():
            return
        cfg = self._configs[key]
        platform = cfg["platform"]
        label = cfg.get("label") or cfg.get("channel") or cfg.get("slug") or key

        if platform == "twitch":
            coro = start_twitch_channel(cfg["channel"], label, self.queue)
        elif platform == "youtube":
            coro = start_youtube_channel(cfg, self._youtube_api_key, self.queue)
        elif platform == "kick":
            coro = start_kick_channel(cfg["slug"], label, self.queue)
        else:
            return
        self._tasks[key] = asyncio.create_task(coro)

    def _stop(self, key: str):
        task = self._tasks.get(key)
        if task and not task.done():
            task.cancel()

    def set_enabled(self, key: str, enabled: bool) -> bool:
        if key not in self._configs:
            return False
        self._configs[key]["enabled"] = enabled
        if enabled:
            self._start(key)
        else:
            self._stop(key)
        return True

    def status(self) -> list[dict]:
        out = []
        for key, cfg in self._configs.items():
            task = self._tasks.get(key)
            out.append({
                "key": key,
                "platform": cfg["platform"],
                "label": cfg.get("label") or cfg.get("channel") or cfg.get("slug"),
                "enabled": cfg.get("enabled", True),
                "running": bool(task and not task.done()),
            })
        return out
