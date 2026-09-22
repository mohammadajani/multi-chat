import asyncio
import json
import sys

from multichat.channels import ChannelManager
from multichat.display import TtsFilter, consume
from multichat.streamerbot import StreamerBotRelay
from multichat.webapp import Hub, run_webui

CONFIG_PATH = "config.json"


def load_config(path: str = CONFIG_PATH) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Missing {path}. Copy config.example.json to {path} (or just open the web "
              f"setup page once it's running, save, then restart).")
        sys.exit(1)


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
        asyncio.create_task(consume(queue, tts_filter, relay, hub)),
        asyncio.create_task(run_webui(hub, web_cfg.get("host", "127.0.0.1"), web_cfg.get("port", 8765))),
    ]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped.")
