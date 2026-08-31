# media/ — script → voice → video

Everything here is spike scaffolding. No app code imports it; it reads nothing but
`.env` (for `OPENROUTER_API_KEY`) and writes only to `renders/`.

```
node render.mjs bits/tequila-attack-ad.json              # audio + video
node render.mjs bits/foo.json --audio-only               # just the mp3
node say.mjs --text "..." --out x.wav --voice ash        # one line
```

Re-runs are cached per segment (`renders/.work/<id>/NN.wav`), so editing one line only
re-voices that line. Delete the work dir to force a full re-render.

## Pipeline

1. **`say.mjs`** — one line → one wav, via OpenRouter `openai/gpt-audio-mini`.
2. **`render.mjs`** — voices each segment separately, screenshots one card per segment
   with Puppeteer, then muxes so **each card holds for exactly its own line's duration**.
   Per-segment TTS is the whole trick: one long narration would mean guessing at sync.

## Four things that were not obvious

**1. Audio output requires `stream: true`, and only as `pcm16`.**
`{"format":"wav"}` is rejected outright when streaming; audio arrives as base64 chunks on
`choices[].delta.audio.data`. `say.mjs` reassembles the stream and lets ffmpeg wrap the raw
PCM (24 kHz mono) into the target container.

**2. The model answers the script instead of reading it.**
The very first test — `"Ska rule -1, sorry"` — came back as a voice saying *"No problem at
all! Take your time and let me know what you'd like to adjust."* It read the line as a
message addressed to it. Fixed by fencing the copy in `<script>` tags and instructing the
model that it is a voice-over artist performing copy, not a participant.

**3. It refuses lines, and *speaks the refusal* in a normal voice.**
This is the dangerous one. `"Grant Koziol's review, in full: fuck you"` produced a
perfectly clean, correctly-paced 10-second clip of *"I'm here to help by framing things in
a constructive way…"* — which would have gone into the video and looked fine on the
timeline. Nothing downstream could catch it.

So `say.mjs` now **compares the returned transcript against the input** and exits non-zero
below 60% word overlap. Refusals are stochastic (the same line passes on one attempt and
fails on the next), so it retries — `--retries`, default 3.

Two escape hatches, both used here:
- `"model": "openai/gpt-audio"` — the full model reads *"lard ass"*; mini won't. Needed 8
  retries even so.
- Omit `say` entirely → **silent card**. Used for Grant Koziol's two-word review, and it is
  funnier than voicing it: the announcer declining to read the line is the joke.

**4. Pacing has to be taken, not asked for.**
The direction "brisk, no dramatic pauses" is ignored. The first attack-ad cut ran **84
seconds** for ~25 seconds of content. Fixed with ffmpeg `atempo` (`"rate": 1.3`–`1.35`),
which is deterministic. Same script, 39 seconds.

## Cost

`gpt-audio-mini` at $0.60/M audio tokens. All four bits — 41 voiced segments, several
re-rendered two or three times — came to a few cents. Cost is not a constraint on this
idea; the constraint is finding incidents worth voicing.

## Spec format

```jsonc
{
  "id": "tequila-court",
  "voice": "ash",              // alloy ash ballad coral echo sage shimmer verse
  "rate": 1.3,                 // ffmpeg atempo; ~1.3 is natural broadcast pace
  "style": "Direction for the performance.",
  "segments": [
    { "kind": "title",         // title | stat | quote | body(default) — styling only
      "card": "On-screen text\n>>lines starting >> render as a verbatim quote",
      "say":  "What the voice reads. Omit for a silent card.",
      "hold": 0.5,             // extra seconds after the line lands
      "voice": "echo",         // per-segment overrides
      "model": "openai/gpt-audio",
      "retries": 8 }
  ]
}
```

## House rule that came out of building these

**End on the subject's own words, not on the AI's verdict.** The court bit doesn't deliver
a sentence — it reads Conor's own chat message back to him. That is both funnier and the
only thing that keeps a bit at a real person's expense fair.
