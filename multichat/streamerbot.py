import aiohttp


class StreamerBotRelay:
    """Talks to Streamer.bot's built-in HTTP server (Servers/Clients > HTTP Server
    in Streamer.bot -- make sure it's enabled, and that its port matches config).

    This calls DoAction on a Streamer.bot action you create once:
      1. In Streamer.bot, add a new Action, e.g. "Multichat TTS"
      2. Add a sub-action: Core > Speak.bot > Speak
      3. Set Message to %message% (a Streamer.bot argument variable)
      4. Copy the Action's GUID (or just use its name) into config.json
    """

    def __init__(self, host: str, port: int, action_name: str | None = None,
                 action_id: str | None = None):
        self.url = f"http://{host}:{port}/DoAction"
        self.action_name = action_name
        self.action_id = action_id

    async def speak(self, session: aiohttp.ClientSession, username: str, text: str, platform: str) -> bool:
        action = {}
        if self.action_id:
            action["id"] = self.action_id
        if self.action_name:
            action["name"] = self.action_name
        if not action:
            return False

        payload = {
            "action": action,
            "args": {
                "message": text,
                "user": username,
                "platform": platform,
            },
        }
        try:
            async with session.post(self.url, json=payload,
                                     timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return resp.status in (200, 204)
        except Exception as exc:
            print(f"[streamerbot] failed to relay TTS: {exc}")
            return False
