import fs from 'node:fs';
import path from 'node:path';
import type { VideoPick } from './videoReview.js';

/**
 * The MLB playlist page: a round's music videos as a standalone web page on
 * digest.mattmariani.com/p/<slug>/.
 *
 * A sibling to the YouTube playlist, not a replacement — it exists because it
 * can say things a YouTube playlist cannot. It shows which SONG each video
 * belongs to, who chose it (a submitter's own link vs something search turned
 * up), and how confident the machine was. It also has no creation cap, which
 * makes it the fallback when YouTube refuses to make another playlist.
 *
 * One self-contained file, no build step and no JS framework: it is served by a
 * dumb static Caddy over a read-only volume, so anything it needs it has to
 * carry. Fonts come from the digest bundle on the same host.
 */

const DIGESTS_DIR = process.env.DIGESTS_DIR ?? '/app/digests';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface PlaylistPageInput {
  roundName: string;
  leagueTitle: string;
  /** Only the picks that are in the playlist. */
  picks: VideoPick[];
  /** The YouTube playlist, when one was built. */
  youtubeUrl?: string | null;
}

/**
 * A "play them all" link that needs no playlist to exist. YouTube builds a
 * temporary playlist from the ids in the query string; it tops out around 50.
 *
 * `title` is undocumented but real — verified against YouTube on 2026-09-07:
 * without it the playlist panel reads "Untitled List", with it the panel shows
 * the title. Worth passing, since this link is how most people will actually
 * play the round.
 */
export function watchAllUrl(videoIds: string[], title?: string | null): string | null {
  const ids = videoIds.slice(0, 50);
  if (!ids.length) return null;
  const q = new URLSearchParams({ video_ids: ids.join(',') });
  if (title) q.set('title', title);
  // URLSearchParams percent-encodes the commas between ids, which YouTube then
  // fails to split on — put the ids back verbatim.
  return `https://www.youtube.com/watch_videos?${q.toString().replace(/%2C/g, ',')}`;
}

interface Entry {
  videoId: string;
  videoTitle: string;
  channel: string | null;
  song: string;
  artists: string;
  fromComment: boolean;
  score: number;
  manual: boolean;
}

export function entriesFor(picks: VideoPick[]): Entry[] {
  const out: Entry[] = [];
  for (const p of picks) {
    for (const id of p.chosen) {
      const c = p.candidates.find((x) => x.videoId === id);
      out.push({
        videoId: id,
        videoTitle: c?.title ?? p.title,
        channel: c?.channel ?? null,
        song: p.title,
        artists: p.artists,
        fromComment: p.source === 'comment',
        score: c?.score ?? p.score,
        manual: !!c?.manual,
      });
    }
  }
  return out;
}

export function buildPlaylistPageHtml(input: PlaylistPageInput): string {
  const entries = entriesFor(input.picks);
  const watchAll = watchAllUrl(entries.map((e) => e.videoId), `${input.leagueTitle} · ${input.roundName}`);
  const guessed = entries.filter((e) => !e.fromComment && !e.manual).length;

  const cards = entries
    .map((e, i) => {
      // Provenance is the point of this page existing, so it is a visible badge
      // rather than a footnote.
      const badge = e.fromComment
        ? '<span class="badge badge-pick">submitter’s pick</span>'
        : e.manual
          ? '<span class="badge badge-hand">added by hand</span>'
          : `<span class="badge badge-found">found by search · ${e.score}%</span>`;
      return `<li class="card">
  <button class="thumb" data-v="${esc(e.videoId)}" aria-label="Play ${esc(e.videoTitle)}">
    <img src="https://i.ytimg.com/vi/${esc(e.videoId)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">
    <span class="play" aria-hidden="true">▶</span>
    <span class="num">${i + 1}</span>
  </button>
  <div class="meta">
    <p class="song">${esc(e.song)}</p>
    <p class="artist">${esc(e.artists)}</p>
    <p class="vid"><a href="https://www.youtube.com/watch?v=${esc(e.videoId)}" target="_blank" rel="noreferrer">${esc(e.videoTitle)}</a></p>
    <p class="chan">${esc(e.channel ?? '')}</p>
    ${badge}
  </div>
</li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(input.roundName)} — the videos</title>
<link rel="stylesheet" href="/d/boarz-chat-superlatives/_app/fonts.css">
<style>
:root{
  --ink-0:#07090c;--ink-1:#0d1116;--ink-2:#141921;--ink-4:#283039;
  --fg:#f1f4f7;--fg-2:#c2cad3;--fg-muted:#8b97a4;--fg-quiet:#5a6773;
  --pulp:#ff5b2e;--pulp-edge:#8a2d15;--bone:#faf7f2;
  --display:"Bricolage Grotesque",system-ui,sans-serif;
  --body:"Inter Tight",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,monospace;
}
*{margin:0;box-sizing:border-box}
body{background:var(--ink-0);color:var(--fg);font-family:var(--body);
  -webkit-font-smoothing:antialiased;padding:0 0 4rem}
.wrap{max-width:44rem;margin:0 auto;padding:0 1rem}
header{padding:2.5rem 0 1.25rem;border-bottom:1px solid var(--ink-4);margin-bottom:1.5rem}
.kicker{font-family:var(--mono);font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--pulp)}
h1{font-family:var(--display);font-weight:800;font-size:clamp(1.7rem,6vw,2.6rem);line-height:1.05;
  letter-spacing:-.02em;margin:.35rem 0 .6rem;text-wrap:balance}
.sub{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;color:var(--fg-muted);text-transform:uppercase}
.actions{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.1rem}
.btn{display:inline-block;font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;
  font-weight:700;text-decoration:none;padding:.6rem .95rem;border-radius:.4rem;transition:.15s}
.btn-main{background:var(--pulp);color:var(--ink-0)}
.btn-main:hover{background:#ff7550}
.btn-ghost{border:1px solid var(--ink-4);color:var(--fg-muted)}
.btn-ghost:hover{color:var(--fg);border-color:var(--pulp)}
ol{list-style:none;padding:0;display:flex;flex-direction:column;gap:.9rem}
.card{display:flex;gap:.85rem;background:var(--ink-1);border:1px solid var(--ink-4);border-radius:.6rem;
  padding:.7rem;align-items:flex-start}
.thumb{position:relative;flex:none;width:9.5rem;max-width:38vw;border:0;padding:0;background:none;cursor:pointer;
  border-radius:.4rem;overflow:hidden;line-height:0}
.thumb img{width:100%;height:auto;display:block;border-radius:.4rem}
.thumb .play{position:absolute;inset:0;display:grid;place-items:center;font-size:1.5rem;color:#fff;
  background:rgba(7,9,12,.34);opacity:.92;transition:.15s}
.thumb:hover .play{background:rgba(7,9,12,.12)}
.thumb .num{position:absolute;top:.25rem;left:.35rem;font-family:var(--mono);font-size:.65rem;font-weight:700;
  color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.meta{min-width:0;flex:1}
.song{font-weight:700;font-size:.98rem;line-height:1.2}
.artist{font-family:var(--mono);font-size:.68rem;color:var(--fg-quiet);margin-top:.1rem;text-transform:uppercase;letter-spacing:.06em}
.vid{font-size:.82rem;margin-top:.4rem;color:var(--fg-2);overflow-wrap:anywhere}
.vid a{color:var(--fg-2);text-decoration:none;border-bottom:1px solid transparent}
.vid a:hover{color:var(--pulp);border-bottom-color:var(--pulp)}
.chan{font-family:var(--mono);font-size:.66rem;color:var(--fg-quiet);margin-top:.15rem}
.badge{display:inline-block;margin-top:.45rem;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;
  text-transform:uppercase;padding:.2rem .45rem;border-radius:.25rem;border:1px solid}
.badge-pick{color:var(--pulp);border-color:var(--pulp)}
.badge-hand{color:#7ddf7d;border-color:#3f7d3f}
.badge-found{color:var(--fg-quiet);border-color:var(--ink-4)}
.card.playing{flex-direction:column}
.card.playing .thumb{width:100%;max-width:none;aspect-ratio:16/9}
.card.playing iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:.4rem;display:block}
footer{margin-top:2.5rem;padding-top:1.1rem;border-top:1px solid var(--ink-4);
  font-family:var(--mono);font-size:.66rem;line-height:1.7;color:var(--fg-quiet)}
@media (max-width:26rem){ .card{flex-direction:column} .thumb{width:100%;max-width:none} }
</style>
</head><body>
<div class="wrap">
<header>
  <p class="kicker">${esc(input.leagueTitle)} · MLB playlist</p>
  <h1>${esc(input.roundName)}</h1>
  <p class="sub">${entries.length} video${entries.length === 1 ? '' : 's'}</p>
  <div class="actions">
    ${watchAll ? `<a class="btn btn-main" href="${esc(watchAll)}" target="_blank" rel="noreferrer">▶ Play them all</a>` : ''}
    ${input.youtubeUrl ? `<a class="btn btn-ghost" href="${esc(input.youtubeUrl)}" target="_blank" rel="noreferrer">Save to YouTube</a>` : ''}
  </div>
</header>

<ol>
${cards}
</ol>

<footer>
  Tap a thumbnail to watch it here.${guessed ? ` ${guessed} of these were found automatically — if one is wrong, that is why.` : ''}<br>
  Built by the Music League bot.
</footer>
</div>
<script>
// Swap a thumbnail for the real player, one at a time, and only on demand —
// a dozen autoloading iframes is a bad way to open a link on a phone.
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.thumb');
  if (!btn) return;
  var card = btn.closest('.card');
  var f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + btn.dataset.v + '?autoplay=1&rel=0';
  f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
  f.allowFullscreen = true;
  f.title = card.querySelector('.song').textContent;
  card.classList.add('playing');
  btn.replaceWith(f);
});
</script>
</body></html>`;
}

/** Write the page and return its public path segment. */
export function writePlaylistPage(slug: string, input: PlaylistPageInput): string {
  const dir = path.join(DIGESTS_DIR, 'p', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildPlaylistPageHtml(input));
  return `/p/${slug}/`;
}
