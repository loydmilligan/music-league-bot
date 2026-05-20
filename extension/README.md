# MLB Song Ingest — Chrome Extension

One-click ingest of Spotify tracks, albums, and playlists into your Music
League Bot shortlist. Chrome Manifest V3, no build step.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select the `extension/` directory in this repo.
4. The toolbar icon `MLB` appears. Pin it for easy access.

## Configure

1. Click the toolbar icon → click the **⚙** in the popup header, or open
   `chrome://extensions` and click the extension's **Details → Extension
   options**.
2. In the options page:
   - **API base URL** — leave at `https://mlb.mattmariani.com` unless you
     run a different instance.
   - **Bearer token** — generate one at
     `<base>/settings/api-tokens` (the link in the options page points
     you there). The plaintext is shown **once** when you generate the
     token; paste it into the options page and click **Save**.
3. Click **Test connection** — should report `OK — connected to <base>`.
   - `401` means the token is wrong or revoked.
   - A network error means the API base URL is unreachable from your
     browser.

## Use

1. Open any Spotify page in `https://open.spotify.com/`:
   - `track/<id>` — adds one track.
   - `album/<id>` — adds all tracks on the album.
   - `playlist/<id>` — adds every track in the playlist.
2. Click the toolbar icon. The popup shows the detected kind, title, and
   artist / owner / count.
3. Click **Add to shortlist**. Result appears in the popup:
   - `Added N tracks` — success, with the first few titles previewed.
   - `Skipped M (already in shortlist)` — dedup, harmless.
   - Errors are listed individually if anything fails.

## Supported URL patterns

Matches the backend's parser exactly:

```
https://open.spotify.com/track/<id>
https://open.spotify.com/album/<id>
https://open.spotify.com/playlist/<id>
https://open.spotify.com/intl-<locale>/track/<id>     (and album / playlist)
```

Spotify's `?si=…` share-link suffix is stripped automatically.

## Troubleshooting

- **Popup says "Navigate to a Spotify page"** — you're on something other
  than a track / album / playlist resource page (e.g. `/search`, `/home`).
- **Popup says "Spotify page loaded before the extension was ready"** —
  reload the tab. Content scripts only inject on fresh page loads; if the
  tab was open before the extension was installed, it has no content
  script yet.
- **`Token rejected`** — re-check the token in options. If you revoked
  the old one in the webapp, generate a new one.
- **`Editorial playlist` failed with a Spotify 404** — Spotify restricts
  the algorithmic `/playlist/37i9dQZF…` IDs from the public API path the
  backend uses. User-owned playlists work; editorial ones don't (yet).
- **Album / playlist count not shown in the popup** — Spotify's
  `og:description` format changes occasionally. Cosmetic only; the
  backend still ingests every track.

## File layout

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker — `POST /api/ingest/songs` |
| `content-spotify.js` | Detects the active Spotify resource |
| `popup.html` / `popup.js` | Toolbar popup UI |
| `options.html` / `options.js` | API base URL + token configuration |

No external dependencies, no build step. Edit a file → reload the
extension at `chrome://extensions` (click the ⟳ icon on the extension
card) and the change is live.

## Versioning

The extension follows the MLB repo. `manifest.json` `version` is bumped
when shipping incompatible changes. v0.1.0 = sprint-10 Wave 2 baseline:
Spotify only, single global shortlist, static Bearer token.
