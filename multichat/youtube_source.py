import asyncio

import aiohttp

from .models import ChatMessage

YT_API_BASE = "https://www.googleapis.com/youtube/v3"


async def _find_live_chat_id(session: aiohttp.ClientSession, api_key: str,
                              channel_id: str | None, video_id: str | None):
    """Returns (video_id, live_chat_id) or (None, None) if nothing is live.

    If video_id is given directly, this only costs 1 quota unit (videos.list).
    If only channel_id is given, it first does a search.list call to find the
    live video, which costs 100 quota units -- fine occasionally, but avoid
    polling this in a tight loop.
    """
    if not video_id and channel_id:
        params = {
            "part": "id",
            "channelId": channel_id,
            "eventType": "live",
            "type": "video",
            "key": api_key,
        }
        async with session.get(f"{YT_API_BASE}/search", params=params) as resp:
            data = await resp.json()
        items = data.get("items", [])
        if not items:
            return None, None
        video_id = items[0]["id"]["videoId"]

    if not video_id:
        return None, None

    params = {"part": "liveStreamingDetails", "id": video_id, "key": api_key}
    async with session.get(f"{YT_API_BASE}/videos", params=params) as resp:
        data = await resp.json()
    items = data.get("items", [])
    if not items:
        return None, None
    chat_id = items[0].get("liveStreamingDetails", {}).get("activeLiveChatId")
    return video_id, chat_id


async def start_youtube_channel(cfg: dict, api_key: str, queue: asyncio.Queue):
    """cfg: {"label": "YT-Main", "channel_id": "UCxxxx"} or {"video_id": "..."}.
    Runs forever until the owning asyncio.Task is cancelled (e.g. toggled off
    in the UI). While the channel isn't live, this only checks back every 60s
    -- turning a channel off in the UI stops even that idle polling entirely."""
    label = cfg.get("label", cfg.get("channel_id") or cfg.get("video_id") or "YouTube")
    channel_id = cfg.get("channel_id")
    video_id = cfg.get("video_id")

    if not api_key:
        print(f"[youtube:{label}] no api_key set, skipping")
        return

    async with aiohttp.ClientSession() as session:
        while True:
            try:
                vid, chat_id = await _find_live_chat_id(session, api_key, channel_id, video_id)
                if not chat_id:
                    print(f"[youtube:{label}] not live yet, checking again in 60s")
                    await asyncio.sleep(60)
                    continue

                print(f"[youtube:{label}] connected to live chat (video {vid})")
                page_token = None
                while True:
                    params = {"liveChatId": chat_id, "part": "snippet,authorDetails", "key": api_key}
                    if page_token:
                        params["pageToken"] = page_token
                    async with session.get(f"{YT_API_BASE}/liveChat/messages", params=params) as resp:
                        if resp.status != 200:
                            # chat likely ended -- break out and re-detect the next live video
                            break
                        data = await resp.json()

                    for item in data.get("items", []):
                        snippet = item.get("snippet", {})
                        author = item.get("authorDetails", {})
                        text = snippet.get("displayMessage", "")
                        if not text:
                            continue
                        await queue.put(ChatMessage(
                            platform="youtube",
                            channel=label,
                            username=author.get("displayName", "?"),
                            text=text,
                        ))

                    page_token = data.get("nextPageToken")
                    poll_seconds = max(data.get("pollingIntervalMillis", 5000), 2000) / 1000
                    await asyncio.sleep(poll_seconds)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[youtube:{label}] error ({exc}), retrying in 30s")
                await asyncio.sleep(30)
