# Build a Free Popularity-Proxy Sorter for Song CSVs — Node.js Web App Agent Brief

## Goal

Implement a Node.js web app that accepts a CSV with exactly these input fields:

```csv
artist,song_title,spotifylink
```

The app should return/export a CSV sorted by **artist** and then by a **free, reliable stand-in for popularity**. Do **not** depend on Spotify popularity, because Spotify API availability and exposed popularity fields may vary by app/account/API policy.

The recommended popularity proxy is **Last.fm global listener/playcount data**, optionally improved with a MusicBrainz MBID lookup for better disambiguation.

---

## Recommended popularity proxy

### Primary source: Last.fm `track.getInfo`

Use Last.fm's public API method `track.getInfo`.

Why:

- Free API key.
- Does not require user authentication for global track metadata.
- Returns global track statistics such as `listeners` and `playcount` when available.
- Supports lookup by `artist` + `track`, and optionally by MusicBrainz ID (`mbid`).

Last.fm docs: <https://www.last.fm/api/show/track.getInfo>

### Optional disambiguation source: MusicBrainz

Use MusicBrainz to find a recording MBID from `artist + song_title`, then pass that MBID into Last.fm where possible.

Why:

- Free and open music metadata database.
- Useful when titles are ambiguous, remastered, duplicated, or have punctuation differences.
- Must be rate-limited. MusicBrainz asks API clients not to exceed **1 request per second** and to set a proper `User-Agent`.

MusicBrainz API docs: <https://musicbrainz.org/doc/MusicBrainz_API>
MusicBrainz rate limiting: <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
MusicBrainz search docs: <https://musicbrainz.org/doc/MusicBrainz_API/Search>

---

## Popularity score definition

Create a transparent proxy score rather than calling it Spotify popularity.

Suggested output columns:

```csv
artist,song_title,spotifylink,lastfm_listeners,lastfm_playcount,popularity_proxy,match_status,match_source,error
```

Suggested score:

```js
popularity_proxy = Math.round(
  70 * logNormalize(lastfm_playcount) +
  30 * logNormalize(lastfm_listeners)
)
```

Where `logNormalize` is calculated across the songs in the uploaded CSV:

```js
function logNormalize(value, maxValue) {
  const v = Number(value || 0);
  const m = Number(maxValue || 0);
  if (!m || m <= 0) return 0;
  return Math.log10(v + 1) / Math.log10(m + 1) * 100;
}
```

Rationale:

- `playcount` captures total historical popularity.
- `listeners` reduces bias from a small number of repeat listeners.
- Log normalization prevents mega-hits from flattening the rest of the list.
- The score is relative to the uploaded batch, so it is best for sorting the user's submitted songs, not comparing all songs globally.

Fallback score when only one metric exists:

```js
if (playcount && listeners) score = weightedScore;
else if (playcount) score = Math.round(logNormalize(playcount, maxPlaycount));
else if (listeners) score = Math.round(logNormalize(listeners, maxListeners));
else score = 0;
```

---

## Sorting behavior

Sort rows by:

1. `artist` ascending, case-insensitive.
2. `popularity_proxy` descending.
3. `lastfm_playcount` descending.
4. `lastfm_listeners` descending.
5. `song_title` ascending, case-insensitive.

Example:

```js
rows.sort((a, b) => {
  const artistCmp = a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
  if (artistCmp !== 0) return artistCmp;

  if (b.popularity_proxy !== a.popularity_proxy) {
    return b.popularity_proxy - a.popularity_proxy;
  }

  if (b.lastfm_playcount !== a.lastfm_playcount) {
    return b.lastfm_playcount - a.lastfm_playcount;
  }

  if (b.lastfm_listeners !== a.lastfm_listeners) {
    return b.lastfm_listeners - a.lastfm_listeners;
  }

  return a.song_title.localeCompare(b.song_title, undefined, { sensitivity: 'base' });
});
```

---

## Implementation approach

Build a small Express app with:

- `GET /` — upload form.
- `POST /api/sort` — accepts CSV upload and returns JSON preview.
- `POST /api/export` or same `/api/sort?format=csv` — returns sorted CSV.

Use:

```bash
npm install express multer csv-parse csv-stringify p-limit dotenv
```

Recommended environment variables:

```bash
LASTFM_API_KEY=your_lastfm_api_key
APP_USER_AGENT="song-popularity-sorter/1.0 your-email@example.com"
ENABLE_MUSICBRAINZ=false
LASTFM_CONCURRENCY=3
```

Keep MusicBrainz disabled by default because it is slower due to rate limits. Add it as an optional accuracy mode.

---

## File structure

```txt
song-popularity-sorter/
  package.json
  .env.example
  server.js
  src/
    csv.js
    lastfm.js
    musicbrainz.js
    scoring.js
    sortSongs.js
  public/
    index.html
```

---

## Node.js snippets

### `src/lastfm.js`

```js
const LASTFM_ROOT = 'https://ws.audioscrobbler.com/2.0/';

function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  return String(value || '').trim();
}

async function getLastfmTrackInfo({ artist, track, mbid, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Missing LASTFM_API_KEY');

  const params = new URLSearchParams({
    method: 'track.getInfo',
    api_key: apiKey,
    format: 'json',
    autocorrect: '1'
  });

  if (mbid) {
    params.set('mbid', mbid);
  } else {
    params.set('artist', cleanText(artist));
    params.set('track', cleanText(track));
  }

  const url = `${LASTFM_ROOT}?${params.toString()}`;
  const res = await fetchImpl(url);

  if (!res.ok) {
    throw new Error(`Last.fm HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    return {
      listeners: 0,
      playcount: 0,
      match_status: 'not_found',
      match_source: mbid ? 'lastfm_mbid' : 'lastfm_artist_track',
      error: data.message || `Last.fm error ${data.error}`
    };
  }

  const t = data.track;
  if (!t) {
    return {
      listeners: 0,
      playcount: 0,
      match_status: 'not_found',
      match_source: mbid ? 'lastfm_mbid' : 'lastfm_artist_track',
      error: 'No track object returned'
    };
  }

  return {
    listeners: toInt(t.listeners),
    playcount: toInt(t.playcount),
    match_status: 'matched',
    match_source: mbid ? 'lastfm_mbid' : 'lastfm_artist_track',
    lastfm_name: t.name || '',
    lastfm_artist: t.artist?.name || ''
  };
}

module.exports = { getLastfmTrackInfo };
```

---

### `src/musicbrainz.js` optional

```js
const MB_ROOT = 'https://musicbrainz.org/ws/2/recording/';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeLucene(value) {
  return String(value || '')
    .replace(/[+\-!(){}[\]^"~*?:\\/]/g, '\\$&')
    .trim();
}

async function findRecordingMbid({ artist, track, userAgent, fetchImpl = fetch }) {
  if (!userAgent) throw new Error('Missing APP_USER_AGENT for MusicBrainz');

  const query = `recording:"${escapeLucene(track)}" AND artist:"${escapeLucene(artist)}"`;
  const params = new URLSearchParams({
    query,
    fmt: 'json',
    limit: '1'
  });

  const res = await fetchImpl(`${MB_ROOT}?${params.toString()}`, {
    headers: { 'User-Agent': userAgent }
  });

  if (!res.ok) {
    throw new Error(`MusicBrainz HTTP ${res.status}`);
  }

  const data = await res.json();
  const best = data.recordings?.[0];
  return best?.id || null;
}

// Use this wrapper if processing multiple rows. MusicBrainz requests should be sequential.
async function findRecordingMbidRateLimited(args) {
  const result = await findRecordingMbid(args);
  await sleep(1100);
  return result;
}

module.exports = { findRecordingMbid, findRecordingMbidRateLimited };
```

---

### `src/scoring.js`

```js
function logNormalize(value, maxValue) {
  const v = Number(value || 0);
  const m = Number(maxValue || 0);
  if (!m || m <= 0) return 0;
  return (Math.log10(v + 1) / Math.log10(m + 1)) * 100;
}

function addPopularityScores(rows) {
  const maxPlaycount = Math.max(...rows.map(r => Number(r.lastfm_playcount || 0)), 0);
  const maxListeners = Math.max(...rows.map(r => Number(r.lastfm_listeners || 0)), 0);

  return rows.map(row => {
    const playcount = Number(row.lastfm_playcount || 0);
    const listeners = Number(row.lastfm_listeners || 0);

    const playScore = logNormalize(playcount, maxPlaycount);
    const listenerScore = logNormalize(listeners, maxListeners);

    let popularity_proxy = 0;
    if (playcount > 0 && listeners > 0) {
      popularity_proxy = Math.round((0.7 * playScore) + (0.3 * listenerScore));
    } else if (playcount > 0) {
      popularity_proxy = Math.round(playScore);
    } else if (listeners > 0) {
      popularity_proxy = Math.round(listenerScore);
    }

    return { ...row, popularity_proxy };
  });
}

module.exports = { addPopularityScores, logNormalize };
```

---

### `src/sortSongs.js`

```js
const pLimit = require('p-limit');
const { getLastfmTrackInfo } = require('./lastfm');
const { addPopularityScores } = require('./scoring');
const { findRecordingMbidRateLimited } = require('./musicbrainz');

function validateRow(row) {
  const required = ['artist', 'song_title', 'spotifylink'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`Missing required CSV column: ${key}`);
    }
  }
}

function normalizeInputRow(row) {
  validateRow(row);
  return {
    artist: String(row.artist || '').trim(),
    song_title: String(row.song_title || '').trim(),
    spotifylink: String(row.spotifylink || '').trim()
  };
}

async function enrichRows(rows, options) {
  const {
    lastfmApiKey,
    enableMusicBrainz = false,
    userAgent,
    lastfmConcurrency = 3
  } = options;

  const normalized = rows.map(normalizeInputRow);

  let mbidByIndex = new Map();
  if (enableMusicBrainz) {
    // Sequential because of MusicBrainz rate limits.
    for (let i = 0; i < normalized.length; i += 1) {
      const row = normalized[i];
      try {
        const mbid = await findRecordingMbidRateLimited({
          artist: row.artist,
          track: row.song_title,
          userAgent
        });
        if (mbid) mbidByIndex.set(i, mbid);
      } catch (err) {
        // Continue; Last.fm artist+track lookup can still work.
      }
    }
  }

  const limit = pLimit(Number(lastfmConcurrency || 3));

  const enriched = await Promise.all(normalized.map((row, index) => limit(async () => {
    try {
      const mbid = mbidByIndex.get(index);
      const info = await getLastfmTrackInfo({
        artist: row.artist,
        track: row.song_title,
        mbid,
        apiKey: lastfmApiKey
      });

      return {
        ...row,
        lastfm_listeners: info.listeners,
        lastfm_playcount: info.playcount,
        match_status: info.match_status,
        match_source: info.match_source,
        error: info.error || ''
      };
    } catch (err) {
      return {
        ...row,
        lastfm_listeners: 0,
        lastfm_playcount: 0,
        match_status: 'error',
        match_source: 'lastfm_artist_track',
        error: err.message
      };
    }
  })));

  const scored = addPopularityScores(enriched);

  scored.sort((a, b) => {
    const artistCmp = a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
    if (artistCmp !== 0) return artistCmp;

    if (b.popularity_proxy !== a.popularity_proxy) {
      return b.popularity_proxy - a.popularity_proxy;
    }

    if (b.lastfm_playcount !== a.lastfm_playcount) {
      return b.lastfm_playcount - a.lastfm_playcount;
    }

    if (b.lastfm_listeners !== a.lastfm_listeners) {
      return b.lastfm_listeners - a.lastfm_listeners;
    }

    return a.song_title.localeCompare(b.song_title, undefined, { sensitivity: 'base' });
  });

  return scored;
}

module.exports = { enrichRows };
```

---

### `src/csv.js`

```js
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

function parseCsv(buffer) {
  return parse(buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function rowsToCsv(rows) {
  return stringify(rows, {
    header: true,
    columns: [
      'artist',
      'song_title',
      'spotifylink',
      'lastfm_listeners',
      'lastfm_playcount',
      'popularity_proxy',
      'match_status',
      'match_source',
      'error'
    ]
  });
}

module.exports = { parseCsv, rowsToCsv };
```

---

### `server.js`

```js
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const { parseCsv, rowsToCsv } = require('./src/csv');
const { enrichRows } = require('./src/sortSongs');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/sort', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing CSV file field named "file"' });
    }

    const rows = parseCsv(req.file.buffer);
    const sortedRows = await enrichRows(rows, {
      lastfmApiKey: process.env.LASTFM_API_KEY,
      enableMusicBrainz: process.env.ENABLE_MUSICBRAINZ === 'true',
      userAgent: process.env.APP_USER_AGENT,
      lastfmConcurrency: Number(process.env.LASTFM_CONCURRENCY || 3)
    });

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="songs_sorted_by_popularity_proxy.csv"');
      return res.send(rowsToCsv(sortedRows));
    }

    return res.json({ rows: sortedRows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
```

---

### `public/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Song Popularity Proxy Sorter</title>
</head>
<body>
  <h1>Song Popularity Proxy Sorter</h1>
  <p>Upload a CSV with columns: artist, song_title, spotifylink.</p>

  <form id="upload-form">
    <input type="file" name="file" accept=".csv,text/csv" required />
    <button type="submit">Sort and download CSV</button>
  </form>

  <pre id="status"></pre>

  <script>
    const form = document.getElementById('upload-form');
    const status = document.getElementById('status');

    form.addEventListener('submit', async event => {
      event.preventDefault();
      status.textContent = 'Processing...';

      const formData = new FormData(form);
      const res = await fetch('/api/sort?format=csv', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const text = await res.text();
        status.textContent = text;
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'songs_sorted_by_popularity_proxy.csv';
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = 'Done.';
    });
  </script>
</body>
</html>
```

---

## Package file

### `package.json`

```json
{
  "name": "song-popularity-proxy-sorter",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "csv-parse": "latest",
    "csv-stringify": "latest",
    "dotenv": "latest",
    "express": "latest",
    "multer": "latest",
    "p-limit": "latest"
  }
}
```

### `.env.example`

```bash
LASTFM_API_KEY=replace_me
APP_USER_AGENT="song-popularity-sorter/1.0 your-email@example.com"
ENABLE_MUSICBRAINZ=false
LASTFM_CONCURRENCY=3
PORT=3000
```

---

## CSV example

Input:

```csv
artist,song_title,spotifylink
Radiohead,Creep,https://open.spotify.com/track/70LcF31zb1H0PyJoS1Sx1r
Radiohead,No Surprises,https://open.spotify.com/track/10nyNJ6zNy2YVYLrcwLccB
Nirvana,Smells Like Teen Spirit,https://open.spotify.com/track/5ghIJDpPoe3CfHMGu71E6T
```

Output:

```csv
artist,song_title,spotifylink,lastfm_listeners,lastfm_playcount,popularity_proxy,match_status,match_source,error
Nirvana,Smells Like Teen Spirit,https://open.spotify.com/track/5ghIJDpPoe3CfHMGu71E6T,1234567,9876543,100,matched,lastfm_artist_track,
Radiohead,Creep,https://open.spotify.com/track/70LcF31zb1H0PyJoS1Sx1r,1000000,8000000,96,matched,lastfm_artist_track,
Radiohead,No Surprises,https://open.spotify.com/track/10nyNJ6zNy2YVYLrcwLccB,900000,6000000,91,matched,lastfm_artist_track,
```

The numbers above are placeholders. The implemented app must use live Last.fm API responses.

---

## Reliability notes for the coding agent

1. **Call this a popularity proxy, not exact popularity.**
   It is based on Last.fm listeners and playcounts, not Spotify streams.

2. **Keep original rows even when lookup fails.**
   Set `lastfm_listeners = 0`, `lastfm_playcount = 0`, `popularity_proxy = 0`, and fill `error`.

3. **Preserve `spotifylink`.**
   It is an input identifier for the user's convenience, but the proposed score does not use Spotify.

4. **Do not scrape websites.**
   Use documented APIs.

5. **Implement caching if the app may process repeated uploads.**
   Cache by normalized `artist + song_title`, and optionally by MBID.

6. **Normalize text before lookup.**
   Trim whitespace. Keep original casing in output.

7. **Handle duplicate songs.**
   If identical `artist + song_title` appears multiple times, reuse one API result.

8. **Rate limits.**
   Last.fm concurrency should stay modest, for example 3 parallel requests. MusicBrainz should be sequential at roughly 1 request per second.

9. **Privacy.**
   The app does not need the user's Spotify credentials or Last.fm user account. It only needs a Last.fm API key on the server.

10. **Testing.**
    Add unit tests for scoring and sorting. Mock Last.fm responses rather than hitting APIs in tests.

---

## Acceptance criteria

- User can upload a CSV with columns `artist`, `song_title`, `spotifylink`.
- App validates required columns.
- App calls Last.fm `track.getInfo` for each unique artist/title pair.
- App computes `popularity_proxy` from `lastfm_playcount` and `lastfm_listeners`.
- App sorts by artist ascending and score descending.
- App returns a downloadable CSV.
- Failed lookups do not break the whole upload.
- Output includes `match_status`, `match_source`, and `error` fields.
- No Spotify API call is required.

