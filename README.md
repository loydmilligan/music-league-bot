# Music League Bot

A private, just-for-fun WhatsApp group bot scaffold for collecting songs shared by friends and placing them into Spotify and/or YouTube playlists according to configurable rules.

This repo is intentionally a scaffold. It does not implement WhatsApp, Spotify, or YouTube integrations yet.

## Intended flow

```text
WhatsApp group message
  ↓
Song-link parser
  ↓
Track resolver
  ↓
Rules engine
  ↓
Spotify / YouTube playlist adapters
  ↓
Bot confirmation reply
```

## Suggested stack

- Node.js + TypeScript
- WhatsApp Web integration via `whatsapp-web.js` or Baileys
- Spotify Web API
- YouTube Data API
- SQLite for a small private deployment
- Optional Docker deployment

## Quick start

```bash
npm install
cp .env.example .env
cp config/rules.example.json config/rules.json
npm run dev
```

At this stage, `npm run dev` runs a demo showing the parser and rules engine in action.

## Running tests

```bash
npm test
```

To run a specific test file:

```bash
npm test -- tests/parser.test.ts
npm test -- tests/rules.test.ts
npm test -- tests/config.test.ts
```

The test suite covers the message parser (all `!song` command variants) and the rules engine (command matching, tag matching, template resolution, wildcard submitter). No external API calls are made.

## Important note

WhatsApp Web automation may be fragile and may not be officially supported by WhatsApp. For a private friend-group bot, keep usage narrow, low-volume, and non-spammy.
