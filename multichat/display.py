import asyncio
import time
from collections import deque

import aiohttp
from rich.console import Console

from .models import ChatMessage
from .streamerbot import StreamerBotRelay

PLATFORM_STYLE = {
    "twitch": "bold magenta",
    "youtube": "bold red",
    "kick": "bold green",
}


class TtsFilter:
    """Decides which messages actually get spoken, and rate-limits the flow
    so a busy chat doesn't flood Speaker.bot with a wall of TTS requests."""

    def __init__(self, tts_cfg: dict):
        self.enabled = tts_cfg.get("enabled", False)
        self.mode = tts_cfg.get("mode", "all")            # "all" | "prefix"
        self.prefix = tts_cfg.get("prefix", "!tts")
        self.min_length = tts_cfg.get("min_length", 2)
        self.max_length = tts_cfg.get("max_length", 200)
        self.skip_commands = tts_cfg.get("skip_commands", True)
        self.max_per_10s = tts_cfg.get("max_per_10s", 5)
        self._recent = deque()

    def should_speak(self, text: str) -> tuple[bool, str]:
        if not self.enabled:
            return False, text
        if self.skip_commands and text.startswith("!") and self.mode != "prefix":
            return False, text
        if self.mode == "prefix":
            if not text.lower().startswith(self.prefix.lower()):
                return False, text
            text = text[len(self.prefix):].strip()
        if not (self.min_length <= len(text) <= self.max_length):
            return False, text

        now = time.monotonic()
        while self._recent and now - self._recent[0] > 10:
            self._recent.popleft()
        if len(self._recent) >= self.max_per_10s:
            return False, text
        self._recent.append(now)
        return True, text


async def consume(queue: asyncio.Queue, tts_filter: TtsFilter, relay: StreamerBotRelay | None,
                   hub=None):
    console = Console()
    async with aiohttp.ClientSession() as session:
        while True:
            msg: ChatMessage = await queue.get()
            text = msg.clean_text()
            if not text:
                continue

            style = PLATFORM_STYLE.get(msg.platform, "white")
            console.print(
                f"[{style}]\\[{msg.platform}:{msg.channel}][/{style}] "
                f"[bold]{msg.username}[/bold]: {text}"
            )

            if hub is not None:
                await hub.broadcast(msg)

            if relay is not None:
                speak, spoken_text = tts_filter.should_speak(text)
                if speak:
                    await relay.speak(session, msg.username, spoken_text, msg.platform)
