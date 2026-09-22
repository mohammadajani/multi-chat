from dataclasses import dataclass, field
import time


@dataclass
class ChatMessage:
    """One normalized chat message, regardless of which platform it came from."""

    platform: str          # "twitch" | "youtube" | "kick"
    channel: str            # your label for the account/channel, e.g. "YT-Main"
    username: str
    text: str
    ts: float = field(default_factory=time.time)

    def clean_text(self) -> str:
        """Text with control characters stripped, safe to hand to TTS / print."""
        return "".join(ch for ch in self.text if ch.isprintable()).strip()
