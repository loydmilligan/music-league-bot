// YouTube Music detector. Mirrors content-spotify.js: replies to {type:'detect'}
// from the popup with {ok, kind, url, title, artist?, count?}.
//
// The backend (Wave 3 / T9) resolves YTM URLs to Spotify via Songlink, so the
// extension only needs to surface a canonical URL plus cosmetic metadata.
//
// YTM URL shapes:
//   watch    music.youtube.com/watch?v=<videoId>             (single track)
//   playlist music.youtube.com/playlist?list=<playlistId>    (playlist)
//   browse   music.youtube.com/browse/<browseId>             (album: MPRE…, artist: MPLA… — we only surface albums)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'detect') {
    sendResponse(detect());
    return false;
  }
  return false;
});

function detect() {
  const u = new URL(window.location.href);
  const path = u.pathname;

  if (path === '/watch') {
    const v = u.searchParams.get('v');
    if (!v) return { ok: false, reason: 'YTM watch page is missing v=' };
    // Strip everything except v= so Songlink gets a clean canonical URL.
    const canonical = `https://music.youtube.com/watch?v=${v}`;
    const { title, artist } = parseWatchTitle(getMeta('og:title') || document.title || '');
    return { ok: true, kind: 'track', url: canonical, title, artist };
  }

  if (path === '/playlist') {
    const list = u.searchParams.get('list');
    if (!list) return { ok: false, reason: 'YTM playlist page is missing list=' };
    const canonical = `https://music.youtube.com/playlist?list=${list}`;
    const ogTitle = getMeta('og:title') || '';
    const title = stripYtmSuffix(ogTitle || document.title || '');
    return { ok: true, kind: 'playlist', url: canonical, title };
  }

  if (path.startsWith('/browse/')) {
    const browseId = path.slice('/browse/'.length).split('/')[0];
    if (!browseId) return { ok: false, reason: 'YTM browse page missing id' };
    // MPRE… = album/release page; MPLA… = artist page; others are home/explore/etc.
    if (browseId.startsWith('MPRE')) {
      const canonical = `https://music.youtube.com/browse/${browseId}`;
      const ogTitle = getMeta('og:title') || '';
      const title = stripYtmSuffix(ogTitle || document.title || '');
      const ogDesc = getMeta('og:description') || '';
      const artist = parseAlbumArtist(ogDesc);
      const out = { ok: true, kind: 'album', url: canonical, title };
      if (artist) out.artist = artist;
      return out;
    }
    return { ok: false, reason: 'not a YTM track / album / playlist page' };
  }

  return { ok: false, reason: 'not a YTM track / album / playlist page' };
}

function getMeta(property) {
  const el = document.querySelector(`meta[property="${property}"]`);
  return el ? el.getAttribute('content') : '';
}

// Watch-page <title> pattern: "<Song> - <Artist> - YouTube Music"
// og:title is usually just "<Song>" (no suffix) — try og:title first, then
// fall back to parsing document.title.
function parseWatchTitle(raw) {
  const clean = stripYtmSuffix(raw);
  // If og:title was clean (no " - "), we likely don't have artist here. Try
  // parsing the <title> separately for the artist segment.
  if (clean === raw.replace(/\s*-\s*YouTube Music\s*$/i, '').trim() && !clean.includes(' - ')) {
    const docTitle = document.title || '';
    const m = docTitle.match(/^(.+?)\s+-\s+(.+?)\s+-\s+YouTube Music\s*$/i);
    if (m) return { title: m[1].trim(), artist: m[2].trim() };
    return { title: clean, artist: '' };
  }
  // Combined "Song - Artist" form
  const m = clean.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: clean, artist: '' };
}

function stripYtmSuffix(s) {
  return s.replace(/\s*-\s*YouTube Music\s*$/i, '').trim();
}

// Album og:description typically starts with the artist name, sometimes followed
// by " · Album · YEAR" or similar. Best-effort only — popup degrades gracefully
// if this returns empty.
function parseAlbumArtist(desc) {
  if (!desc) return '';
  const parts = desc.split(/[·•]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && !/^album$/i.test(parts[0])) return parts[0];
  if (parts.length > 1) return parts[1];
  return '';
}
