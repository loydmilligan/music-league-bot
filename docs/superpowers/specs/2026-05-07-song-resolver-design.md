# Song Resolver Design

**Date:** 2026-05-07
**Status:** Approved

## Goal

Implement a resolver layer that sits between the message parser and the rules engine. It takes a `ParsedSubmission` (URL or artist/title text) and returns a `ResolutionResult` — a resolved track plus a status that tells the bot layer whether and how to notify.

## Architecture

Three new units:

| File | Responsibility |
|------|----------------|
| `src/resolver/types.ts` | `ResolutionResult` type |
| `src/resolver/resolveTrack.ts` | Pure resolution function |
| `tests/resolver.test.ts` | Unit tests with mocked adapter |

The config schema (`src/config/types.ts`) gains a `notifications` block. The existing `rulesConfigSchema` is extended — no new config file.

## Data Flow

```
ParsedSubmission (from parser)
  ↓
resolveTrack(submission, adapter, config)
  ↓
ResolutionResult { track, status, query }
  ↓
WhatsApp layer (future) reads status → sends notification if needed
```

The resolver is a pure function. It never sends notifications — it only classifies the result. Notification dispatch belongs to the WhatsApp adapter layer, which is not built yet.

## ResolutionResult Type

```typescript
type ResolutionStatus = 'found' | 'low-confidence' | 'not-found';

interface ResolutionResult {
  track: ResolvedTrack | null;  // null when status is 'not-found'
  status: ResolutionStatus;
  query: string;                // what was searched, used in notification messages
}
```

## Resolution Logic

Priority order:

1. **Spotify track URL** (`open.spotify.com/track/<id>` or `spotify:track:<id>`) → extract ID → `adapter.getTrackById(id)` → status `found` (confidence 1.0). If the adapter returns null (track not found on Spotify), status is `not-found`.
2. **YouTube URL** (`youtube.com/watch`, `youtu.be`) → status `not-found` with a descriptive query string. Stub for now; YouTube adapter is a future milestone.
3. **Other URL** → status `not-found`.
4. **Artist + title text** (`artistHint` and `titleHint` both present) → `adapter.searchTrack("artist - title")` → if null, status `not-found`; if result returned, confidence is checked against threshold (see below).
5. **No URL, no parseable text** → status `not-found`.

## Confidence Threshold

After a successful `searchTrack()` call:

- If `track.confidence >= config.notifications.confidenceThreshold` → status `found`
- If `track.confidence < config.notifications.confidenceThreshold` → status `low-confidence`

Direct ID lookups (`getTrackById`) always produce status `found` when a track is returned — confidence is implicitly 1.0 and threshold does not apply.

## Notification Config (extends rules.json)

Added to `rulesConfigSchema`:

```typescript
notifications: z.object({
  onFailure: z.boolean().default(true),
  onLowConfidence: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.9),
  recipients: z.enum(['me', 'submitter', 'me-and-submitter']).default('me'),
}).optional()
```

The `notifications` block is optional. When absent, defaults apply (notify on both failure and low-confidence, notify only `me`).

The WhatsApp layer will read this config to decide whether and to whom to send a notification when status is `low-confidence` or `not-found`. The resolver itself does not read notification config — only the threshold.

## Error Handling

- Adapter throws `SpotifyApiError` → propagate; the bot layer handles it (not the resolver's job to swallow unexpected API errors).
- Adapter returns null (valid not-found) → `not-found` status.

## Testing

Unit tests in `tests/resolver.test.ts` with a mocked `ISpotifyAdapter`. Cover:

- Spotify track URL (HTTPS and URI formats) → `found`
- YouTube URL → `not-found` with youtube stub message
- Other URL → `not-found`
- Artist + title text, search returns a track, confidence ≥ threshold → `found`
- Artist + title text, search returns a track, confidence < threshold → `low-confidence`
- Artist + title text, search returns null → `not-found`
- No URL, no text hints → `not-found`
- Adapter throws → error propagates

## Spotify URL Parsing

Handle two formats:
- `https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7` — extract last path segment before any `?`
- `spotify:track:4LRPiXqCikLlN15c3yImP7` — extract third colon-separated segment

Both map to the same `getTrackById` call.

## config/rules.example.json update

Add an example `notifications` block so users know the options exist:

```json
"notifications": {
  "onFailure": true,
  "onLowConfidence": true,
  "confidenceThreshold": 0.9,
  "recipients": "me"
}
```

## Out of Scope

- Sending notifications (WhatsApp layer)
- YouTube resolution (future milestone)
- Album or playlist URL handling (future milestone)
- Deduplication checks (future milestone, likely in bot layer)
