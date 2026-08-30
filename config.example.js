// Copy this file to config.js and fill in your own values.
// Nothing here needs a paid API tier - Twitch chat reading needs no auth at all,
// and YouTube live chat reading only needs a free Data API key (no OAuth) as long
// as the broadcast's chat is public.

module.exports = {
  // Any number of Twitch channels (channel = the broadcaster's login name, lowercase).
  // Reading chat needs no login of your own - tmi.js connects anonymously.
  twitchChannels: [
    "your_twitch_channel",
  ],

  // Your YouTube Data API v3 key. Create one free at:
  // https://console.cloud.google.com/apis/credentials  (enable "YouTube Data API v3")
  youtubeApiKey: "YOUR_YOUTUBE_API_KEY",

  // Any number of YouTube live broadcasts - this is what covers BOTH your two
  // separate YouTube accounts AND YouTube's native dual-stream feature: each
  // destination/broadcast still has its own video ID and its own live chat under
  // the hood, so just list every one you want pulled in here.
  //
  // videoId = the 11-character ID from the live stream's watch URL
  // (https://www.youtube.com/watch?v=XXXXXXXXXXX)
  youtubeStreams: [
    { label: "YT - Main", videoId: "VIDEO_ID_1" },
    { label: "YT - Alt",  videoId: "VIDEO_ID_2" },
  ],

  // How often to poll each YouTube chat, in ms. YouTube tells the API what its
  // own recommended interval is per response; we respect the larger of that and
  // this floor so you don't burn your daily quota (10k units/day free tier -
  // each poll costs ~5 units, so 3000+ polls/day per stream is plenty of headroom).
  youtubeMinPollMs: 3000,

  // Port the local dashboard/server runs on
  port: 4545,
};
