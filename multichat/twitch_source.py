import asyncio
import random
import re

from .models import ChatMessage

TWITCH_IRC_HOST = "irc.chat.twitch.tv"
TWITCH_IRC_PORT = 6667

# Matches a tagged PRIVMSG line, e.g.:
# @badge-info=;color=#FF0000;display-name=Foo;... :foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :hello world
PRIVMSG_RE = re.compile(
    r"^@(?P<tags>\S+)\s+:(?P<user>[^!]+)!\S+ PRIVMSG #(?P<channel>\S+) :(?P<message>.*)$"
)


async def start_twitch_channel(channel: str, label: str, queue: asyncio.Queue):
    """Connects anonymously (read-only, no account/token needed) and joins one
    channel. Reconnects with backoff if the connection drops. Runs forever
    until the owning asyncio.Task is cancelled (e.g. toggled off in the UI),
    at which point the socket is closed cleanly.
    """
    backoff = 5
    nick = f"justinfan{random.randint(10000, 99999)}"

    while True:
        writer = None
        try:
            reader, writer = await asyncio.open_connection(TWITCH_IRC_HOST, TWITCH_IRC_PORT)
            writer.write(b"CAP REQ :twitch.tv/tags twitch.tv/commands\r\n")
            writer.write(f"NICK {nick}\r\n".encode())
            writer.write(f"JOIN #{channel.lower()}\r\n".encode())
            await writer.drain()
            backoff = 5  # reset after a successful connect

            while True:
                line = await reader.readline()
                if not line:
                    raise ConnectionError("Twitch IRC connection closed")
                line = line.decode(errors="ignore").rstrip("\r\n")

                if line.startswith("PING"):
                    writer.write(b"PONG :tmi.twitch.tv\r\n")
                    await writer.drain()
                    continue

                match = PRIVMSG_RE.match(line)
                if match:
                    await queue.put(ChatMessage(
                        platform="twitch",
                        channel=label,
                        username=match.group("user"),
                        text=match.group("message"),
                    ))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[twitch:{label}] connection error ({exc}), retrying in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
        finally:
            if writer is not None:
                writer.close()
