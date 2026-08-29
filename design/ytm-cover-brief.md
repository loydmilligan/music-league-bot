# Design Brief — Weekly YTM Playlist Cover (WhatsApp asset)

**For:** Claude Designer (CD) · **From:** CC / Matt · **Date:** 2026-08-29
**Task type:** small recurring asset, not a UI screen. One 1:1 image per Music League round.

The design system will be provided separately in the CD session — this brief deliberately
contains **no visual direction**. It contains what the artifact is, where it lives, what data a
generator has at its disposal, and what we need back.

---

## 1. What this artifact is

Every week the bot auto-creates a YouTube Music mirror of the round's Spotify playlist and posts
it to the league's WhatsApp group ("Boarz II Men", 10 players, profane-comedy register — round
names like "I Hope You Shit Your Pants at Target" are normal and welcome). The post is a
**media message**: our image on top, a short caption + playlist link below. The image IS the
thumbnail — there is no og:image dance; we control every pixel.

The cover must be **regenerated programmatically for every round with zero human touch**. CD is
designing a *template/recipe*, not a one-off artwork.

## 2. Display context (hard facts)

- WhatsApp group chat media message. Rendered ~full bubble width on phones (~300–350px
  visually), compressed by WhatsApp on send. Must also read as a tiny chat-list preview.
- Canvas: 1:1, we render at 640×640 (can go higher, e.g. 1024×1024, if a concept wants it).
- Caption text (round name + link) sits BELOW the image in the bubble — the image doesn't have
  to carry the link or repeat the caption, but may carry text if the concept wants it.
- One per week, in an active chat — it should be recognizable as "the weekly playlist drop"
  at a glance across weeks. (assumption: series recognizability matters; see decision D2.)

## 3. The generator — what the renderer can actually do

- HTML/CSS (or SVG/canvas) rendered headless (Chromium screenshot). Full CSS: filters,
  gradients, blend modes, masks, grids. All raster inputs are fetched ahead of time and
  inlined — no network at render time.
- Self-hosted fonts available: Bricolage Grotesque, Inter Tight, JetBrains Mono (the ones the
  design system uses; more can be added).
- **No AI image generation in the weekly loop** — output must be deterministic from round data.
  (A one-time AI-generated background/texture asset that gets reused every week IS allowed.)
- Concepts must state how they degrade: 6–12 songs per round, very long round titles (up to
  ~45 chars seen), occasional missing album art, occasional non-Spotify (YouTube-only) tracks
  whose only art is a 16:9 video thumbnail.

## 4. Data available per round AT SEND TIME (the honest inventory)

The cover generates when the playlist drops — **during the round, before results**. Submitter
identities and scores are secret at that moment (anonymous submission + a whole guessing
culture — the cover must never leak who submitted what).

Available:
- **Round**: name (comedic/profane), round number (1–N), theme description text (1–3 sentences,
  e.g. "Songs that make it clear—I don't like you."), theme submitter name (public), deadlines.
- **Per song** (6–12 of them, anonymized): title, artist(s), album name, release year,
  **Spotify album art URL (640×640)**, and the resolved **YouTube video id** → YT thumbnails
  (default/hq/maxres, 16:9). Duration.
- **League-level (static)**: league name "Boarz II Men", the 10-player roster, player avatar
  images (existing avatar system), season number, the league's existing per-player accent
  colors, all prior rounds' names/art (history is available if a concept wants continuity,
  e.g. "Round 7 of the season").
- **Playlist-level**: track count, total runtime, the YTM link itself, the Spotify playlist's
  auto mosaic cover (4-album grid, 640px).

NOT available at send time: winners, points, vote comments, who submitted anything.

## 5. What we need back: 5 distinct concepts

Not final art — **five genuinely different ideas**, each specified as:
1. Name + one short paragraph of the idea.
2. Which data from §4 it consumes, and what varies week to week vs. stays fixed.
3. A rough mock or sketch of one example round (use round 4, "I Hope You Shit Your Pants at
   Target", 10 tracks, as the worked example — its 10 album art URLs can be pulled from the
   Spotify playlist https://open.spotify.com/playlist/5kzR1yj304SMrxKhz7wQoz).
4. Degradation notes per §3 (long title, missing art, 6 vs 12 songs).
5. Honest cost note: trivially templatable / needs a one-time asset / needs new fonts etc.

"Distinct" means different structural ideas — not five recolors of one layout.

## 6. Decision points

- **D1 [Required — from team]: Text-on-image or textless?** The caption already names the round.
  Baked-in title text makes the image self-contained (forwards well) but duplicates the caption
  and fights long profane titles. Would help to see at least one concept each way.
- **D2 [Proposed by CC]: Fixed series identity vs. weekly variation.** Same recognizable frame
  every week (brand the drop) vs. each round's art dominating (celebrate the theme). Concepts
  may take either stance but must say which.
- **D3 [Proposed by CC]: How much song art to show.** All N covers, a curated few, or none
  (theme-text-driven). Note: showing covers is safe (playlist is public) but showing N covers
  telegraphs track count — fine, not secret.
- **D4 (unknown — needs decision later, not blocking):** whether the same template should also
  serve the *results/reveal* repost after voting closes (when winner data IS available). Design
  for send-time data only, but note if a concept extends naturally.

## 7. Out of scope

- The caption copy, the send mechanics, and the playlist itself — all handled.
- Any redesign of digest pages or the Boarz Tape. This is one image.
