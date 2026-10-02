# Boarz Season 1 review page

The unlisted review page lives at `/boarz-season-1` on the existing `bot-ui` origin (`mlb13.mattmariani.com`, port 3002). It uses a standalone layout and is not linked from the Music League Bot navigation. The operator host's existing Cloudflare Access policy applies. The public `digest.mattmariani.com` static server is not used.

The page reads, but never writes, the sibling `boarz-season-1-cinematic` repository. In Docker, `bot-ui` mounts that repository read-only at `/app/boarz-season-1-cinematic`; local development finds it next to `music-league-bot`. `BOARZ_REVIEW_DIR` can override the location.

Each player appears from `players/<slug>/dossier/player-profile.json`. Filled sections of `players/<slug>/concept-candidates.md` become candidate tabs. Empty templates stay marked as in progress. The page does not mark a concept approved or change either repository.

Supported images and videos placed anywhere beneath `players/<slug>/generations/` or `players/<slug>/selects/` appear in that player's media gallery on the next page load. Supported extensions: PNG, JPEG, WebP, GIF, AVIF, MP4, WebM, and MOV. Media is served through a validated, read-only app route with byte-range support for video. Keep source prompts and provider metadata beside the generated files as required by the Boarz project; this page displays the media files only.

Deployment after a code change: rebuild and restart `bot-ui` with the existing Compose project. New concept text and media files are read live through the mount and need no rebuild.
