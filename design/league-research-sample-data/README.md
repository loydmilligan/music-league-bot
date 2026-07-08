# League Research — sample data

Real exports from two leagues, straight from the app's DB (`data/league.db`).
Use them to populate the League Research mockups so the heatmap /
obscurity-drift / genre-radar canvases sit on real distributions, real names, and
real coverage gaps. Nothing here is invented.

**The two leagues exercise deliberately different realities — use both:**

| League | Files prefix | Seasons | Rounds | Players | Notable realities |
|---|---|---|---|---|---|
| **Second Best** | `second-best_*` | 1 (complete) | 10 | 14 | Full album art; **sparse genre tags**; **downvotes present** (negative points) |
| **Hip Jammers** | `hip-jammers_*` | 3 (S1/S2 complete, **S3 active**) | 9 / 10 / 8 | 10 distinct | **Sparse album art (36%)** → initial-fallback is the majority case; **no downvotes**; multi-season |

- **Second Best** is the clean single-league case and the best base for the
  **heatmap** (14 players, dense voting, downvotes to color).
- **Hip Jammers** is the **multi-season** case for the drift chart (facet/scope by
  season; S3 is mid-flight, so its later rounds are the "fresh / pending" reality).
  Its 36% art coverage matches the handoff's "fallback initial is the majority,
  not an edge case" note.

## Files (per league: submissions, votes, players)

### `<league>_submissions.csv` — one row per submitted song
Feeds: **obscurity drift** (per-round obscurity + winners), **genre radar (submit
side)**, **heatmap submitter attributes**.
Columns: `season, round_number, round_name, submitter, title, artist, points,
rank_in_round, is_winner, popularity_proxy, obscurity, energy_pct, lyrics, bpm,
key, scale, duration_s, top_tag, tags, spotify_uri, album_art_url`.

### `<league>_votes.csv` — one row per vote
Feeds: **directional points heatmap** (voter → submitter), **genre radar (vote
side)**. Each row carries the voted song's attributes, so the heatmap's
attribute-lens (recolor by obscurity/energy/genre) can be built from this file alone.
Columns: `season, round_number, voter, submitter, points, title, artist,
submitted_obscurity, submitted_energy_pct, submitted_top_tag, spotify_uri`.

### `<league>_players.csv` — roster convenience (one row per season × player)
Columns: `season, player, songs_submitted, total_points_received, rounds_won`.

## Value scales & conventions (match these in the mockups)

- **obscurity = 100 − popularity_proxy**, 0–100 (higher = more obscure / "Rabbit Hole").
- **energy_pct** is **0–100** (already scaled — do *not* multiply by 100).
- **lyrics** = `on file` / `instrumental` / empty (empty = not analyzed yet).
- **points** can be **negative** (downvotes — present in Second Best, absent in Hip Jammers).
- **tags** is `|`-delimited (top-5 Last.fm genre tags); `top_tag` is the first.
- **is_winner = yes** marks each round's top scorer; ties yield multiple winners
  (e.g. **Second Best round 10 is a genuine 2-way tie for 1st** — design the winner
  marker around it).
- **Scope rule:** never mix players across leagues. Within a league, seasons may be
  aggregated or filtered — the `season` column supports both.

## Coverage realities (design for the gaps — this is the point)

Empty cells = "not analyzed yet / no data" — the greyed / missing states the visuals
must handle, not errors.

| Field | Second Best (112) | Hip Jammers (246) |
|---|---|---|
| obscurity / popularity | 112/112 | 246/246 |
| energy_pct | 100/112 | 245/246 |
| lyrics | 112/112 | 246/246 |
| **top_tag / tags** | **24/112** | **103/246** |
| **album_art_url** | 112/112 | **88/246** |

Genre tags are the sparsest signal in both leagues — the radar and the inline tag
pill must degrade gracefully. Album-art coverage flips between the two leagues, so
test both the real-thumbnail and the initial-fallback paths.
