# Implement Songlink/Odesli Music-Link Resolution for `music-league-bot`

Date: 2026-05-07  
Project root: `/home/loydmilligan/Projects/music-league-bot`  
Project: `music-league-bot`

---

## Target Project Setup

This implementation is for a plain Node.js bot project, not a Supabase project.

Stack:

- Node.js 22
- TypeScript
- ESM with `"type": "module"`
- All relative imports must use `.js` extensions
- Runtime: `tsx` for dev via `npm run dev`
- Build: `tsc`
- Tests: Vitest via `npm test`
- No framework, plain Node.js process

Installed dependencies already available:

- `whatsapp-web.js`
- `better-sqlite3`
- `dotenv`
- `zod`

Current structure:

```text
src/
  bot/          handler.ts, urlDetector.ts
  config/       loader.ts, types.ts
  music/        types.ts
  parser/       parseMessage.ts
  resolver/     resolveTrack.ts
  rules/        engine.ts, templates.ts
  spotify/      adapter.ts, token.ts
  storage/      db.ts, submissions.ts
  whatsapp/     client.ts
  index.ts
tests/
```

Conventions:

- Add new modules under `src/` in the appropriate subdirectory.
- Add tests under `tests/`.
- No `any` types.
- DB code can stay synchronous.
- Network/API code should be async.
- Do not add comments unless the reason is non-obvious.
- ESM imports must include `.js`.
- Must pass:

```bash
npx tsc --noEmit
npm test -- --run
```

---

## Feature Goal

Add a small Songlink/Odesli resolver that accepts:

```text
Spotify URL
Spotify URI
Apple Music URL
YouTube URL
YouTube Music URL
```

and returns cross-platform music links, especially:

```text
Spotify URL
Spotify URI
Apple Music URL
YouTube URL
YouTube Music URL
Songlink universal page URL
```

Recommended API:

```text
https://api.song.link/v1-alpha.1/links?url=<encoded-url>
```

No Songlink/Odesli API key is required.

---

## Where This Should Live

Add this source file:

```text
src/resolver/songlinkResolver.ts
```

Add this test file:

```text
tests/songlinkResolver.test.ts
```

Optional wiring targets:

```text
src/resolver/resolveTrack.ts
src/bot/handler.ts
```

Do **not** add Supabase code. Do **not** add edge functions. This is a local Node.js module.

---

## Public API to Implement

The module should export:

```ts
export type PlatformLinks = {
  spotify?: string;
  spotifyUri?: string;
  appleMusic?: string;
  youtube?: string;
  youtubeMusic?: string;
  tidal?: string;
  deezer?: string;
  amazonMusic?: string;
  pandora?: string;
  songLink?: string;
};

export type SonglinkResolvedTrack = {
  sourceUrl: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  links: PlatformLinks;
};

export type SonglinkResolveError = {
  sourceUrl: string;
  error: string;
  links: PlatformLinks;
};

export type SonglinkResolveResult = SonglinkResolvedTrack | SonglinkResolveError;

export function normalizeSonglinkInput(input: string): string;

export function spotifyUrlToUri(url: string | undefined): string | undefined;

export async function resolveSonglinkUrl(input: string): Promise<SonglinkResolveResult>;

export async function resolveSonglinkBatch(
  inputs: string[],
  options?: { limit?: number; delayMs?: number },
): Promise<SonglinkResolveResult[]>;
```

---

## Source File: `src/resolver/songlinkResolver.ts`

Implement this file:

```ts
const SONG_LINK_API = "https://api.song.link/v1-alpha.1/links";

type SongLinkEntity = {
  id: string;
  type: string;
  title?: string;
  artistName?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  apiProvider: string;
  platforms: string[];
};

type SongLinkPlatformLink = {
  country: string;
  url: string;
  entityUniqueId: string;
};

type SongLinkResponse = {
  entityUniqueId: string;
  userCountry: string;
  pageUrl: string;
  entitiesByUniqueId: Record<string, SongLinkEntity>;
  linksByPlatform: Record<string, SongLinkPlatformLink>;
};

export type PlatformLinks = {
  spotify?: string;
  spotifyUri?: string;
  appleMusic?: string;
  youtube?: string;
  youtubeMusic?: string;
  tidal?: string;
  deezer?: string;
  amazonMusic?: string;
  pandora?: string;
  songLink?: string;
};

export type SonglinkResolvedTrack = {
  sourceUrl: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  links: PlatformLinks;
};

export type SonglinkResolveError = {
  sourceUrl: string;
  error: string;
  links: PlatformLinks;
};

export type SonglinkResolveResult = SonglinkResolvedTrack | SonglinkResolveError;

export function normalizeSonglinkInput(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith("spotify:track:")) {
    const trackId = trimmed.replace("spotify:track:", "");
    return `https://open.spotify.com/track/${trackId}`;
  }

  return trimmed;
}

export function spotifyUrlToUri(url: string | undefined): string | undefined {
  const match = url?.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  return match ? `spotify:track:${match[1]}` : undefined;
}

function getPrimaryEntity(data: SongLinkResponse): SongLinkEntity | undefined {
  const entities = Object.values(data.entitiesByUniqueId ?? {});
  return entities.find((entity) => entity.type === "song") ?? entities[0];
}

function extractLinks(data: SongLinkResponse): PlatformLinks {
  const spotifyUrl = data.linksByPlatform.spotify?.url;

  return {
    songLink: data.pageUrl,
    spotify: spotifyUrl,
    spotifyUri: spotifyUrlToUri(spotifyUrl),
    appleMusic: data.linksByPlatform.appleMusic?.url,
    youtube: data.linksByPlatform.youtube?.url,
    youtubeMusic: data.linksByPlatform.youtubeMusic?.url,
    tidal: data.linksByPlatform.tidal?.url,
    deezer: data.linksByPlatform.deezer?.url,
    amazonMusic: data.linksByPlatform.amazonMusic?.url,
    pandora: data.linksByPlatform.pandora?.url,
  };
}

export async function resolveSonglinkUrl(input: string): Promise<SonglinkResolveResult> {
  const normalizedInput = normalizeSonglinkInput(input);

  if (!normalizedInput) {
    return {
      sourceUrl: input,
      links: {},
      error: "Missing music URL",
    };
  }

  try {
    const response = await fetch(`${SONG_LINK_API}?url=${encodeURIComponent(normalizedInput)}`);

    if (!response.ok) {
      return {
        sourceUrl: input,
        links: {},
        error: response.status === 404
          ? "Track not found on Songlink/Odesli"
          : `Songlink/Odesli API error: ${response.status}`,
      };
    }

    const data = await response.json() as SongLinkResponse;
    const primaryEntity = getPrimaryEntity(data);

    return {
      sourceUrl: input,
      title: primaryEntity?.title,
      artist: primaryEntity?.artistName,
      thumbnail: primaryEntity?.thumbnailUrl,
      links: extractLinks(data),
    };
  } catch (error) {
    return {
      sourceUrl: input,
      links: {},
      error: error instanceof Error ? error.message : "Unknown Songlink/Odesli error",
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function resolveSonglinkBatch(
  inputs: string[],
  options: { limit?: number; delayMs?: number } = {},
): Promise<SonglinkResolveResult[]> {
  const limit = Math.min(options.limit ?? 10, 10);
  const delayMs = options.delayMs ?? 150;
  const inputsToProcess = inputs.slice(0, limit);
  const results: SonglinkResolveResult[] = [];

  for (const input of inputsToProcess) {
    results.push(await resolveSonglinkUrl(input));

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  return results;
}
```

---

## Test File: `tests/songlinkResolver.test.ts`

Implement this test file.

These tests mock `globalThis.fetch`, so they do not hit the real Songlink/Odesli API.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSonglinkInput,
  resolveSonglinkBatch,
  resolveSonglinkUrl,
  spotifyUrlToUri,
} from "../src/resolver/songlinkResolver.js";

const songlinkResponse = {
  entityUniqueId: "SPOTIFY_SONG::123",
  userCountry: "US",
  pageUrl: "https://song.link/i/123",
  entitiesByUniqueId: {
    "SPOTIFY_SONG::123": {
      id: "123",
      type: "song",
      title: "Test Song",
      artistName: "Test Artist",
      thumbnailUrl: "https://example.com/thumb.jpg",
      apiProvider: "spotify",
      platforms: ["spotify", "appleMusic", "youtube"],
    },
  },
  linksByPlatform: {
    spotify: {
      country: "US",
      url: "https://open.spotify.com/track/abc123XYZ",
      entityUniqueId: "SPOTIFY_SONG::123",
    },
    appleMusic: {
      country: "US",
      url: "https://music.apple.com/us/song/test-song/123",
      entityUniqueId: "APPLE_MUSIC_SONG::123",
    },
    youtube: {
      country: "US",
      url: "https://www.youtube.com/watch?v=video123",
      entityUniqueId: "YOUTUBE_VIDEO::video123",
    },
    youtubeMusic: {
      country: "US",
      url: "https://music.youtube.com/watch?v=video123",
      entityUniqueId: "YOUTUBE_MUSIC_VIDEO::video123",
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("songlinkResolver", () => {
  it("converts Spotify track URIs into Spotify URLs", () => {
    expect(normalizeSonglinkInput("spotify:track:abc123")).toBe(
      "https://open.spotify.com/track/abc123",
    );
  });

  it("leaves non-Spotify-URI links unchanged after trimming", () => {
    expect(normalizeSonglinkInput(" https://music.apple.com/us/song/example ")).toBe(
      "https://music.apple.com/us/song/example",
    );
  });

  it("derives Spotify URI from Spotify track URL", () => {
    expect(spotifyUrlToUri("https://open.spotify.com/track/abc123XYZ?si=foo")).toBe(
      "spotify:track:abc123XYZ",
    );
  });

  it("returns undefined when Spotify URI cannot be derived", () => {
    expect(spotifyUrlToUri("https://open.spotify.com/album/abc123")).toBeUndefined();
    expect(spotifyUrlToUri(undefined)).toBeUndefined();
  });

  it("resolves a music URL into platform links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => songlinkResponse,
    } as Response);

    const result = await resolveSonglinkUrl("https://music.apple.com/us/song/test-song/123");

    expect("error" in result).toBe(false);
    expect(result.title).toBe("Test Song");
    expect(result.artist).toBe("Test Artist");
    expect(result.thumbnail).toBe("https://example.com/thumb.jpg");
    expect(result.links.spotify).toBe("https://open.spotify.com/track/abc123XYZ");
    expect(result.links.spotifyUri).toBe("spotify:track:abc123XYZ");
    expect(result.links.appleMusic).toBe("https://music.apple.com/us/song/test-song/123");
    expect(result.links.youtube).toBe("https://www.youtube.com/watch?v=video123");
    expect(result.links.youtubeMusic).toBe("https://music.youtube.com/watch?v=video123");
    expect(result.links.songLink).toBe("https://song.link/i/123");
  });

  it("returns an error object for Songlink/Odesli 404 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await resolveSonglinkUrl("https://example.com/missing");

    expect("error" in result).toBe(true);
    expect(result.error).toBe("Track not found on Songlink/Odesli");
    expect(result.links).toEqual({});
  });

  it("returns an error object for network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await resolveSonglinkUrl("https://example.com/failure");

    expect("error" in result).toBe(true);
    expect(result.error).toBe("network down");
    expect(result.links).toEqual({});
  });

  it("resolves batches with a max of ten inputs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => songlinkResponse,
    } as Response);

    const inputs = Array.from({ length: 12 }, (_, index) => `https://example.com/${index}`);
    const results = await resolveSonglinkBatch(inputs, { delayMs: 0 });

    expect(results).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
```

---

## Wiring Option 1: Use Inside `src/resolver/resolveTrack.ts`

Use this if `resolveTrack.ts` is already responsible for converting arbitrary links into a `ResolvedTrack`.

Add import:

```ts
import { resolveSonglinkUrl } from "./songlinkResolver.js";
```

Then use it where a source URL has already been detected:

```ts
const songlinkResult = await resolveSonglinkUrl(sourceUrl);

if (!("error" in songlinkResult) && songlinkResult.links.spotify) {
  const spotifyUrl = songlinkResult.links.spotify;
  const spotifyUri = songlinkResult.links.spotifyUri;

  // Pass spotifyUrl or spotifyUri into the existing Spotify adapter if needed.
  // Or store the returned links directly with the submission.
}
```

Recommended flow:

```text
incoming message
→ urlDetector finds URLs
→ resolveTrack receives selected source URL
→ songlinkResolver resolves cross-platform links
→ existing Spotify adapter enriches metadata if Spotify URL/URI exists
→ storage/submissions saves canonical links
```

---

## Wiring Option 2: Use Inside `src/bot/handler.ts`

Use this if the bot handler currently sees raw WhatsApp message text and handles commands directly.

Add import:

```ts
import { resolveSonglinkUrl } from "../resolver/songlinkResolver.js";
```

Pseudo-flow:

```ts
const result = await resolveSonglinkUrl(detectedUrl);

if ("error" in result) {
  await message.reply(`I could not resolve that music link: ${result.error}`);
  return;
}

const spotifyLink = result.links.spotify ?? "No Spotify match found";
await message.reply(`Spotify: ${spotifyLink}`);
```

Keep the final response format aligned with the bot’s existing style and rule templates.

---

## Storage Integration

The project stores submissions in SQLite at:

```text
data/submissions.db
```

Use the existing storage layer:

```text
src/storage/db.ts
src/storage/submissions.ts
```

Do not open a second database connection unless that is already the project pattern.

Recommended fields to persist if the schema supports them:

```text
source_url
spotify_url
spotify_uri
apple_music_url
youtube_url
youtube_music_url
song_link_url
title
artist
thumbnail_url
```

If the current schema does not support these columns, update the existing SQLite schema/migration logic in `src/storage/db.ts` according to the project’s pattern.

Possible SQLite additions:

```sql
alter table submissions add column source_url text;
alter table submissions add column spotify_url text;
alter table submissions add column spotify_uri text;
alter table submissions add column apple_music_url text;
alter table submissions add column youtube_url text;
alter table submissions add column youtube_music_url text;
alter table submissions add column song_link_url text;
alter table submissions add column thumbnail_url text;
```

Only add these if they do not already exist. For SQLite, schema changes should be guarded or managed by the project’s existing migration/init logic.

---

## Config / Env

No Songlink/Odesli API key is required.

Optional config values:

```text
SONGLINK_BATCH_LIMIT=10
SONGLINK_BATCH_DELAY_MS=150
```

If adding these, update:

```text
src/config/types.ts
src/config/loader.ts
```

using the existing `zod` validation style.

Do not make these env vars mandatory.

---

## Expected Bot Behavior

Examples:

### Apple Music link

Input:

```text
https://music.apple.com/us/song/...
```

Expected internal result:

```text
Resolve via Songlink/Odesli.
If Spotify exists, use/store Spotify URL and URI.
Preserve Apple Music URL too.
```

### YouTube link

Input:

```text
https://www.youtube.com/watch?v=...
```

Expected internal result:

```text
Resolve via Songlink/Odesli.
If Spotify exists, use/store Spotify URL and URI.
Preserve YouTube URL too.
```

### Spotify URI

Input:

```text
spotify:track:abc123
```

Expected internal result:

```text
Convert to https://open.spotify.com/track/abc123 before sending to Songlink/Odesli.
Return both spotify URL and spotify URI.
```

---

## Acceptance Criteria

The implementation is complete when:

1. `src/resolver/songlinkResolver.ts` exists.
2. `tests/songlinkResolver.test.ts` exists.
3. `resolveSonglinkUrl()` accepts Spotify URI, Spotify URL, Apple Music URL, YouTube URL, and YouTube Music URL.
4. `resolveSonglinkUrl()` returns `spotify`, `spotifyUri`, `appleMusic`, `youtube`, `youtubeMusic`, and `songLink` links when Songlink/Odesli provides them.
5. Errors are returned as typed result objects, not thrown for normal API failures.
6. Batch resolution caps at 10 inputs.
7. Imports use `.js` extensions.
8. No `any` types are introduced.
9. The implementation passes:

```bash
npx tsc --noEmit
npm test -- --run
```

---

## Notes for the Implementing LLM

- This is not a web app and not a Supabase app.
- Do not create an API route or edge function.
- Do not install new dependencies.
- Use global `fetch`, available in Node.js 22.
- Keep the Songlink resolver isolated and easy to test.
- Prefer returning structured results over throwing.
- Do not modify WhatsApp client code unless needed for the selected wiring path.
- Use existing parser/resolver/storage conventions.
- Keep all new imports ESM-compatible and include `.js` extensions.
