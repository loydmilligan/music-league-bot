// Detects the kind of Spotify resource on the current page and extracts
// display metadata for the popup. The backend canonicalizes everything via
// Spotify's API, so this is purely cosmetic — the URL is what actually
// drives ingest.

// Matches the backend's regex (ui/src/lib/spotify/client.ts parseSpotifyUrl)
// minus the spotify:kind:id URI form, which doesn't appear in browser URLs.
const SPOTIFY_PATH_RE =
  /^\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{15,40})(?:[/?#]|$)/;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'detect') {
    sendResponse(detect());
    return false;
  }
  return false;
});

function detect() {
  const url = window.location.href;
  const path = window.location.pathname;
  const m = path.match(SPOTIFY_PATH_RE);
  if (!m) {
    return { ok: false, reason: 'not a Spotify track / album / playlist page' };
  }

  const kind = m[1];
  const title = getMeta('og:title') || document.title || '';
  const desc = getMeta('og:description') || '';

  const out = { ok: true, kind, url, title: cleanTitle(title) };

  if (kind === 'track') {
    out.artist = parseTrackArtist(desc);
  } else if (kind === 'album') {
    const parsed = parseAlbumDesc(desc);
    if (parsed.artist) out.artist = parsed.artist;
    if (parsed.count != null) out.count = parsed.count;
  } else if (kind === 'playlist') {
    const parsed = parsePlaylistDesc(desc);
    if (parsed.owner) out.artist = parsed.owner;
    if (parsed.count != null) out.count = parsed.count;
  }

  return out;
}

function getMeta(property) {
  const el = document.querySelector(`meta[property="${property}"]`);
  return el ? el.getAttribute('content') : '';
}

function cleanTitle(t) {
  // Spotify sometimes appends " - song by X | Spotify" or similar to <title>.
  // og:title is usually clean; strip the " | Spotify" suffix just in case.
  return t.replace(/\s*[|·]\s*Spotify\s*$/i, '').trim();
}

// og:description patterns observed on Spotify (2024-2026):
//   Track:    "Song · <Artist> · <Album> · YEAR"            (centerdot · = U+00B7)
//   Album:    "<Artist> · Album · YEAR · N songs"
//   Playlist: "Playlist · <Owner> · N songs · …"
// These shift occasionally; we degrade gracefully if a piece is missing.
function splitDots(s) {
  return s.split('·').map((p) => p.trim()).filter(Boolean);
}

function parseTrackArtist(desc) {
  const parts = splitDots(desc);
  // Expect ["Song", "<Artist>", ...]; artist is the 2nd segment.
  if (parts.length >= 2) return parts[1];
  return '';
}

function parseAlbumDesc(desc) {
  const parts = splitDots(desc);
  const out = {};
  if (parts.length >= 1) out.artist = parts[0];
  const songs = parts.find((p) => /\bsongs?\b/i.test(p));
  if (songs) {
    const n = parseInt(songs.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n)) out.count = n;
  }
  return out;
}

function parsePlaylistDesc(desc) {
  const parts = splitDots(desc);
  const out = {};
  // "Playlist · <Owner> · N songs · …" — owner is index 1 if first piece is the literal "Playlist"
  if (parts.length >= 2 && /^playlist$/i.test(parts[0])) {
    out.owner = parts[1];
  } else if (parts.length >= 1) {
    out.owner = parts[0];
  }
  const songs = parts.find((p) => /\bsongs?\b/i.test(p));
  if (songs) {
    const n = parseInt(songs.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n)) out.count = n;
  }
  return out;
}
