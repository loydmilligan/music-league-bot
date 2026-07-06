# Backlog

Items parked mid-session; ready to resume.

---

## [PARKED] Metadata enrichment in prediction context

**State:** Code read, no edits made. Fully reproducible from reading the files.

### Sub-task A — Fix round scope picker query in settings queue panel

**File:** `ui/src/routes/settings/+page.server.ts` lines 19–21

**Current:** `SELECT id, name FROM rounds ORDER BY id DESC LIMIT 12`

**Change to:** Only return rounds that have at least one submission **and** have pending/failed metadata jobs:

```sql
SELECT DISTINCT r.id, r.name
FROM rounds r
JOIN ml_submissions ms ON ms.round_id = r.id
JOIN song_metadata_queue smq ON smq.spotify_uri = ms.spotify_uri
WHERE smq.status IN ('pending', 'failed')
ORDER BY r.id DESC
LIMIT 12
```

If no rounds have pending jobs the scope picker will be empty (correct — nothing to scope to).

---

### Sub-task B — Enrich `SubmissionEntry` with Last.fm + audio metadata

**Files:**
- `ui/src/lib/predict/playerContext.ts`
- `ui/src/lib/predict/tasks/tasteFingerprint.ts`
- `ui/src/lib/predict/tasks/submissionPredict.ts`

**Change 1 — `playerContext.ts`:** Add optional fields to `SubmissionEntry`:

```ts
export interface SubmissionEntry {
  round: string;
  title: string;
  artist: string;
  pointsReceived: number;
  // Enrichment fields (null when metadata not yet fetched)
  tags?: string[];      // Last.fm genre tags (from song_popularity.tags JSON)
  listeners?: number;   // Last.fm listeners (from song_popularity.listeners)
  bpm?: number;         // from song_audio_features.bpm
  energy?: number;      // from song_audio_features.energy
  key?: string;         // from song_audio_features.key
  scale?: string;       // from song_audio_features.scale ('major'|'minor')
}
```

**Change 2 — `buildPlayerContext` SQL:** The current implementation calls `getPlayer(db, playerName)` which doesn't return `spotify_uri`. Add a new supplementary query after the existing `allSubs` assignment that fetches metadata by joining on `(round_name, title, artist)` or better: run an enriched query using competitor IDs (same approach as `getPlayer`):

```sql
SELECT r.name AS round, m.title, m.artists AS artist, m.spotify_uri,
       COALESCE(SUM(v.points), 0) AS points,
       sp.tags AS sp_tags, sp.listeners,
       saf.bpm, saf.energy, saf.key, saf.scale
FROM ml_submissions m
JOIN competitors c ON c.id = m.competitor_id
JOIN rounds r ON r.id = m.round_id
JOIN seasons s ON s.id = r.season_id
LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
LEFT JOIN song_audio_features saf ON saf.spotify_uri = m.spotify_uri
WHERE m.competitor_id IN (${placeholders})
GROUP BY m.id
ORDER BY s.season_number, r.created_at, r.id
```

Use this query instead of `getPlayer` for submissions (still call `getPlayer` for `winRate` and `tasteOverlap`). Build competitor IDs from the player_id directly (same logic as `resolvePlayerKey` in playerHistory.ts).

**Change 3 — Prompt updates:** In `buildFingerprintMessages` and `buildSubmissionPredictMessages`, emit the new fields when present:

```
[${s.pointsReceived} pts] ${s.artist} — "${s.title}" (${s.round})${metaStr}
```

Where `metaStr` is e.g. `  [bpm 127 · Dm · energy 0.72 · tags: indie rock, alternative]` — shown only when at least one metadata field is non-null.

**Then:** `npm run check`, commit, build, deploy.
- [PARKED] Audio analysis from a round Spotify playlist — spec: docs/superpowers/specs/2026-07-02-audio-analysis-from-playlist-design.md (approved; go straight to writing-plans on resume)
