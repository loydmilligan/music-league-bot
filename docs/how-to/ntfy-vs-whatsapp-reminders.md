# League reminders: ntfy or WhatsApp

Player-facing how-to for the B-side portal Settings screen. Same copy lives in Tela (Music League space). Each reminder (theme reveal, song/vote deadlines, polls, news, “Results are in” / digest) can go out on **ntfy**, **WhatsApp**, or both. There is no automatic fallback between them.

## WhatsApp

A DM from the league bot, on the number you already use.

- No extra app
- Easy if you already live in the group chat
- Mixes with group noise
- Needs a verified phone number
- Reply **STOP** to turn DMs off

WhatsApp is the low-setup path. Group posts (digest, this week’s YouTube Music playlist + cover) already go out this way; player reminders are the same bot, as a DM.

## ntfy

A tiny notification app that only shows league pings. Tap opens the portal, poll, or digest.

- Quiet: not mixed into the group chat
- Quiet hours (11pm–8am by default) are reliable
- One tap to the right page
- Does not depend on WhatsApp delivery
- One-time setup (install + subscribe)

Use ntfy if you want deadline pings without extra WhatsApp DMs.

## How to set up ntfy

1. Install **ntfy** (Android: Play Store or F-Droid; iPhone: App Store).
2. In the app, set the server to `https://ntfy.mattmariani.com` if it asks.
3. On the league portal **Settings** page, tap **Subscribe** or scan the QR code. That adds your private topic.
4. Tap **Send a test**. You should get a ping within a few seconds.
5. Leave Push on for the events you want (deadlines, theme reveal, results, polls, news).

iPhone: self-hosted ntfy needs the app talking to our server. If the test ping never arrives, check that the server field is `ntfy.mattmariani.com`, not the public ntfy.sh default.

## Which should I pick?

| | WhatsApp | ntfy |
|---|---|---|
| Setup | Already on your phone | Install app + subscribe once |
| Where it shows up | Chat list, with everything else | Its own notification |
| Opens | The chat | The portal / digest / poll |
| Needs | Verified number | The ntfy app |
| Quiet hours | Best-effort | Built in |

You can enable both. You will then get two pings for the same event.

## Turning things off

Settings → that league → Notifications. Toggle Push and WhatsApp per event. WhatsApp DMs also honor **STOP**.
