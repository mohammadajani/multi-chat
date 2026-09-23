import asyncio
import json
import sys
from pathlib import Path

from multichat.channels import ChannelManager
from multichat.display import TtsFilter, consume
from multichat.streamerbot import StreamerBotRelay
from multichat.webapp import Hub, run_webui

DEFAULT_CONFIG = {
    "twitch": {"channels": []},
    "youtube": {"api_key": "", "channels": []},
    "kick": {"channels": []},
    "webui": {"host": "127.0.0.1", "port": 8765},
    "streamerbot": {"host": "127.0.0.1", "port": 7474, "action_name": "Multichat TTS", "action_id": None},
    "tts": {
        "enabled": False, "mode": "all", "prefix": "!tts", "skip_commands": True,
        "min_length": 2, "max_length": 200, "max_per_10s": 5,
    },
    "overlay_theme": {"enabled": False, "css": ""},
}


def app_dir() -> Path:
    """Where config.json should live: next to the .exe when frozen with
    PyInstaller (sys.executable), or next to this script otherwise. Using
    this instead of a bare relative path means the app finds its config
    correctly regardless of the current working directory it's launched
    from (double-click, shortcut, terminal, etc.)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


CONFIG_PATH = str(app_dir() / "config.json")


def load_config(path: str = CONFIG_PATH) -> dict:
    p = Path(path)
    if not p.exists():
        p.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
        print(f"No config.json found -- created a fresh one at {p}.")
        print("Open the dashboard once it's running to fill in your channels.")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


async def main():
    cfg = load_config()
    queue: asyncio.Queue = asyncio.Queue()

    sb_cfg = cfg.get("streamerbot", {})
    tts_cfg = cfg.get("tts", {"enabled": False})
    web_cfg = cfg.get("webui", {"host": "127.0.0.1", "port": 8765})

    relay = None
    if tts_cfg.get("enabled"):
        relay = StreamerBotRelay(
            host=sb_cfg.get("host", "127.0.0.1"),
            port=sb_cfg.get("port", 7474),
            action_name=sb_cfg.get("action_name"),
            action_id=sb_cfg.get("action_id"),
        )

    manager = ChannelManager(queue)
    manager.load(cfg)  # starts a task per channel marked enabled (default: enabled)

    tts_filter = TtsFilter(tts_cfg)
    hub = Hub(CONFIG_PATH, tts_filter, relay, manager)

    tasks = [
        asyncio.create_task(consume(queue, hub)),
        asyncio.create_task(run_webui(hub, web_cfg.get("host", "127.0.0.1"), web_cfg.get("port", 8765))),
    ]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
