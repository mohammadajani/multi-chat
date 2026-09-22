import asyncio
import json

import aiohttp

from .models import ChatMessage

# Kick has no official public real-time chat API. This uses the same public
# Pusher app that kick.com's own web client connects to. It requires no
# login, but it is unofficial and can break without notice if Kick changes
# their frontend -- treat this source as best-effort.
PUSHER_WS_URL = (
    "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679"
    "?protocol=7&client=js&version=8.4.0&flash=false"
)
CHANNEL_INFO_URL = "https://kick.com/api/v2/channels/{slug}"


async def _get_chatroom_id(session: aiohttp.ClientSession, slug: str) -> int | None:
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    async with session.get(CHANNEL_INFO_URL.format(slug=slug), headers=headers) as resp:
        if resp.status != 200:
            return None
        data = await resp.json()
    return data.get("chatroom", {}).get("id")


async def start_kick_channel(slug: str, label: str, queue: asyncio.Queue):
    """Runs forever until the owning asyncio.Task is cancelled (e.g. toggled
    off in the UI), which closes the websocket cleanly."""
    backoff = 10
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                chatroom_id = await _get_chatroom_id(session, slug)
                if not chatroom_id:
                    print(f"[kick:{label}] couldn't resolve chatroom id for '{slug}', "
                          f"retrying in {backoff}s (Kick may be rate-limiting/blocking the request)")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 120)
                    continue

                async with session.ws_connect(PUSHER_WS_URL) as ws:
                    await ws.send_json({
                        "event": "pusher:subscribe",
                        "data": {"channel": f"chatrooms.{chatroom_id}.v2"},
                    })
                    print(f"[kick:{label}] connected (chatroom {chatroom_id})")
                    backoff = 10

                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            continue
                        try:
                            payload = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue

                        if payload.get("event") != "App\\Events\\ChatMessageSentEvent":
                            continue
                        try:
                            inner = json.loads(payload["data"])
                        except (KeyError, json.JSONDecodeError):
                            continue

                        text = inner.get("content") or inner.get("message", {}).get("message", "")
                        sender = inner.get("sender", {})
                        if not text:
                            continue
                        await queue.put(ChatMessage(
                            platform="kick",
                            channel=label,
                            username=sender.get("username", "?"),
                            text=text,
                        ))

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[kick:{label}] error ({exc}), retrying in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 120)
