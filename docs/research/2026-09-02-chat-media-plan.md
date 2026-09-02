# Media in the chat section — what exists, what's missing, what it costs

**Date:** 2026-09-02 · **Context:** R153 chat section wants audio clips, two slideshows, and a scoreboard.

## TL;DR

More is already built than it looks. The digest has a working media pipeline —
hosting, a media object shape, an export-safe rendering rule, and a lightbox —
it just has never been wired into the **chat** section. Two of the four asks
need no new infrastructure at all. Audio is the only genuinely new capability,
and it is blocked on files that do not exist yet.

## What already exists

**Hosting is solved, and needs no deploy.** `digests/_media/` on the host is
bind-mounted read-only into the `digest-static` container (caddy) and served at
`https://digest.mattmariani.com/_media/*`. 27 files live there today, including
`chopped_unc.mp4` + `.jpg` from R147. **Dropping a file in that directory
publishes it immediately** — no rebuild, no restart. Cache-bust with `?v=N`,
which is what existing content does.

**A media object shape, used in two places already:**

```json
{ "src": ".../clip.mp4", "poster": ".../clip.jpg", "caption": "...", "alt": "..." }
```

**`DigestInsights.svelte`** (the Coinage card) renders it with the rule that
matters most:

> PNG/PDF export screenshots the page, and **video elements always capture
> blank** — so the export path prints the `poster` still instead, and a media
> block with no poster is dropped entirely rather than printed empty.

It also has a working lightbox: focus trap, Escape to close, autoplay/loop/
muted/playsinline.

**`ReelSection.svelte`** is a whole media-first section — single video + poster,
with grain, letterbox, accent glow, waveform bars and a "tap for sound" tag.
Content lives in `digest_drafts.reel_content_json`. R149 shipped one. Its own
description is *"weekly chat slideshow/video"*, which is the key insight below.

**The variant registry** (`variants.ts`) already has `chat: true`, rendered by
`ChatMoments.svelte`.

## What's missing

`ChatMoments.svelte` renders `{ summary, moments: [{label, detail}] }` — an
accordion on web, a TOC + detail list on export. **It has no media support of
any kind**: no `<img>`, no `<video>`, no `<audio>`.

There is **no `<audio>` element anywhere in the codebase**, and no multi-image
gallery or carousel component.

## The four asks, by real cost

### 1. Poser scoreboard — cheapest, no assets

Pure data (`jon 1 conor -1` → `-2` → `-3`), so it needs no files, no hosting,
no export fallback beyond plain HTML. It renders identically in web and PNG.
The content is already written into the R153 chat moment as
`media.kind = "scoreboard"` with the three frames.

**Cost:** one small branch in a new `ChatMomentMedia.svelte`. Half a day at most.

### 2. Dog slideshow — use the Reel, don't build a carousel

The established pattern for "slideshow" in this codebase is **not** a JS
carousel — it is a pre-rendered MP4 played as a single video. That is what the
Reel section is, and the comedy-spike `media/` pipeline (say/draw/film/render)
already exists to produce them.

**Recommended:** put the dog show in the existing **Reel** section for R153
rather than building a gallery. Zero new UI. The Reel is already registered,
already renders, already has the export rule.

**Blocker:** the dog photos are WhatsApp attachments and are *not* extracted —
the relay stores `📷 Photo` placeholders. Same manual export problem as audio.

### 3. Mikes & Daves slideshow — lowest value, defer

Same mechanics as the dog slideshow. It is a two-column roll call and would
read fine as text or a single static graphic. Recommend deferring.

### 4. Impersonation audio — the only genuinely new capability

Two separate problems:

**(a) The files do not exist.** The relay records voice notes as
`🎤 Voice message (0:04)` placeholders with no payload. The four clips are:

| when (2026-08-30) | who | length |
|---|---|---|
| 19:48:48 | Matt | 0:04 |
| 19:55:40 | Conor | 0:11 |
| 20:00:51 | Matt | 0:07 |
| 20:04:20 | Conor | 0:05 |

They must be exported from WhatsApp by hand. **Mara's attempt is not in this
group at all** — if it exists it is somewhere else.

**(b) There is no audio player, and export is the hard part.** Audio cannot
render in a PNG/PDF any more than video can. The established rule says print a
static substitute — so an audio block needs a *visual* form: a waveform strip
plus speaker and duration, rendered as markup (not a screenshot of a player).

Useful accident: `ReelSection` **already draws waveform bars** from a simple
height array, and `sintel` (audio analysis) is already mounted into the
container. Peaks can be precomputed at author time and stored in the content
JSON, so the runtime does no audio decoding.

## Proposed build order

1. **Schema first (already done).** The R153 chat content now carries optional
   `media` objects on the relevant moments, with `status: "planned"`.
   `ChatMoments` ignores unknown keys, so this ships safely today and the text
   is live regardless of when the components land.

2. **`ChatMomentMedia.svelte`** — one component, switching on `media.kind`:
   - `scoreboard` → inline markup, no assets *(ship first)*
   - `clip` → lift the video/poster/lightbox pattern from `DigestInsights`
   - `slideshow` → thumbs + lightbox; export prints a contact sheet
   - `audio` → new player (below)

   Mount it inside the existing accordion body in `ChatMoments`, and in the
   export detail block use the static form. Reuse `DigestInsights`'s lightbox
   rather than writing a second one.

3. **Audio player** — `<audio>` + play/pause + a static waveform from a stored
   peaks array, one row per clip with speaker and duration. Export prints the
   waveform and duration, never a dead control.

4. **Assets** — export the 4 voice notes and the dog photos from WhatsApp,
   transcode audio to `.m4a`, drop everything in `digests/_media/`. No deploy.

## Blockers that are yours, not mine

- The 4 voice-note files (and Mara's, if it exists elsewhere).
- The dog photos, if we want a real slideshow rather than the Reel.
- Whether the Butthead/comic-book-guy exchange is real — it is in no corpus.

## What I would cut

The Mikes & Daves slideshow. It is the weakest of the four, needs assets that
do not exist, and the joke ("17 Daves, zero Mikes") lands in one sentence of
text without any picture at all.
