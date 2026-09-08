import fs from 'node:fs';
import path from 'node:path';
import type { VideoPick } from './videoReview.js';
import { bandStampSvg, type BandMember } from './bandStamp.js';

/**
 * The MLB playlist page: a round's music videos as a standalone web page on
 * digest.mattmariani.com/p/<slug>/.
 *
 * A sibling to the YouTube playlist, not a replacement — it exists because it
 * can say things a YouTube playlist cannot. It shows which SONG each video
 * belongs to, who chose it (a submitter's own link vs something search turned
 * up), and it takes votes and messages back from the group.
 *
 * One self-contained file, no build step and no JS framework: it is served by a
 * dumb static Caddy over a read-only volume, so anything it needs it has to
 * carry. Fonts come from the digest bundle on the same host; thumbnails come
 * The write URL shape is `<apiBase>/<slug>/<action>` — slug in the PATH, not in
 * the body. Posting to `<apiBase>/<action>` instead resolves to the read-model
 * route with the action as its slug and 405s on every write; that is exactly
 * what shipped when the page and the endpoints were built by separate agents,
 * and tests/mlbPlaylistContract.test.ts exists to keep the two halves honest.
 *
 * from i.ytimg.com. Writes go to a narrow proxied prefix (`apiBase`) — see
 * design/mlb-playlist-spec.md.
 *
 * The look is the CD packet's "hint of xerox" (design/mlb-playlist-handoff-
 * review.md): the header wears the flyer's halftone, glow and torn tape; the
 * list below it stays a plain, legible list, because the list is the thing
 * people came for.
 */

const DIGESTS_DIR = process.env.DIGESTS_DIR ?? '/app/digests';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A value for an inline <script>. JSON alone is not enough: a literal `</script`
 * anywhere in the string closes the block early and the rest of the page becomes
 * markup.
 */
const jsLiteral = (v: unknown): string => JSON.stringify(v ?? '').replace(/</g, '\\u003c');

/** Someone who may claim an identity on this page. */
export interface RosterPlayer {
  id: string;
  name: string;
}

/**
 * Structurally the `VoteTally` that playlistVotes.ts hands back. Declared here
 * rather than imported so the renderer depends on nothing but its own inputs —
 * the page is also built in tests and from scripts that never open the db.
 */
export interface PlaylistMessage {
  videoId: string;
  playerName: string;
  text: string;
}

export interface PlaylistTally {
  videoId: string;
  up: number;
  down: number;
  stampers: BandMember[];
}

export interface PlaylistPageInput {
  roundName: string;
  leagueTitle: string;
  /** Round number within the league, when known — renders on the tape label. */
  roundNumber?: number | null;
  /** Only the picks that are in the playlist. */
  picks: VideoPick[];
  /** The YouTube playlist, when one was built. */
  youtubeUrl?: string | null;
  /** The 13 players who may claim an identity. Empty = nobody to pick from. */
  roster?: RosterPlayer[];
  /** Counts as of render time; the page reconciles nothing until a reload. */
  tallies?: PlaylistTally[];
  /**
   * Messages Matt has RELEASED. Never the pending queue — an unapproved message
   * on a public page is the one thing this flow exists to prevent.
   */
  messages?: PlaylistMessage[];
  /** Identifies this page to the write API. */
  slug?: string | null;
  /** Where the write endpoints live, as proxied on the public host. */
  apiBase?: string;
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
  score: number;
  manual: boolean;
}

/** D4: what the page says about where a video came from, and its ink. */
export type Provenance = 'THEIR PICK' | 'WE FOUND THIS' | 'BEST GUESS' | 'A GUESS' | 'ADDED BY HAND';

/** One song: the votable primary, its unvotable children, and the words for it. */
export interface SongRow {
  song: string;
  artists: string;
  primary: Entry | null;
  children: Entry[];
  provenance: Provenance;
  /** True only for the search buckets — what the accuracy footnote counts. */
  guessed: boolean;
}

const PROV_INK: Record<Provenance, string> = {
  'THEIR PICK': 'var(--moss)',
  'WE FOUND THIS': 'var(--sky)',
  'BEST GUESS': 'var(--amber)',
  'A GUESS': 'var(--ember)',
  'ADDED BY HAND': 'var(--fg-muted)',
};

/**
 * D4 — provenance as words, never the raw score, which stays admin-only.
 *
 * A hand-added candidate is checked before the pick's own source: `manual` is a
 * fact about *this video* (someone pasted this link), while `source` describes
 * how the song's video was originally hunted for. Reading source first would
 * label a link Matt typed by hand as something search found.
 */
export function provenanceFor(pick: VideoPick, entry: Entry | null): Provenance {
  if (entry?.manual) return 'ADDED BY HAND';
  if (pick.source === 'comment') return 'THEIR PICK';
  const score = entry?.score ?? pick.score;
  if (score >= 70) return 'WE FOUND THIS';
  if (score >= 45) return 'BEST GUESS';
  return 'A GUESS';
}

function entryFor(pick: VideoPick, videoId: string): Entry {
  const c = pick.candidates.find((x) => x.videoId === videoId);
  return {
    videoId,
    videoTitle: c?.title ?? pick.title,
    channel: c?.channel ?? null,
    score: c?.score ?? pick.score,
    manual: !!c?.manual,
  };
}

/**
 * One row per SONG, not per video (D6). `chosen[0]` leads and is the only thing
 * that can be voted on; the rest hang off it collapsed. A song with nothing
 * chosen still gets a row — "no video for this one" is a real answer and the
 * song is still in the round.
 */
export function rowsFor(picks: VideoPick[]): SongRow[] {
  return picks.map((p) => {
    const primary = p.chosen.length ? entryFor(p, p.chosen[0]) : null;
    const provenance = provenanceFor(p, primary);
    return {
      song: p.title,
      artists: p.artists,
      primary,
      children: p.chosen.slice(1).map((id) => entryFor(p, id)),
      provenance,
      guessed: provenance === 'WE FOUND THIS' || provenance === 'BEST GUESS' || provenance === 'A GUESS',
    };
  });
}

const thumbImg = (e: Entry) =>
  `<img src="https://i.ytimg.com/vi/${esc(e.videoId)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">`;

export function buildPlaylistPageHtml(input: PlaylistPageInput): string {
  const rows = rowsFor(input.picks);
  const apiBase = input.apiBase ?? '/api/p';
  const roster = input.roster ?? [];
  const tally = new Map((input.tallies ?? []).map((t) => [t.videoId, t]));
  const saidAbout = new Map<string, PlaylistMessage[]>();
  for (const m of input.messages ?? []) {
    if (!saidAbout.has(m.videoId)) saidAbout.set(m.videoId, []);
    saidAbout.get(m.videoId)!.push(m);
  }
  // Children are still videos of the round, so they play with everything else.
  const playable = rows.flatMap((r) => (r.primary ? [r.primary, ...r.children] : r.children)).map((e) => e.videoId);
  const watchAll = watchAllUrl(playable, `${input.leagueTitle} · ${input.roundName}`);
  const guessed = rows.filter((r) => r.guessed && r.primary).length;
  const label = `${input.leagueTitle}${input.roundNumber ? ` · R${input.roundNumber}` : ''}`;

  const rowHtml = rows
    .map((r, i) => {
      const t = r.primary ? tally.get(r.primary.videoId) : undefined;
      const stamp = t?.stampers?.length ? bandStampSvg(t.stampers, { size: 46 }) : '';
      const lead = r.primary
        ? `<button class="thumb" data-v="${esc(r.primary.videoId)}" aria-label="Play ${esc(r.song)}">
        ${thumbImg(r.primary)}<span class="play" aria-hidden="true">▶</span><span class="num">${i + 1}</span>
      </button>`
        : `<div class="thumb gone"><span class="num">${i + 1}</span></div>`;
      // Only a video can be voted on or talked about, so a song without one
      // carries no controls at all rather than dead ones.
      const controls = r.primary
        ? `<button class="vote up" data-v="${esc(r.primary.videoId)}" data-dir="up" aria-pressed="false">
          <span aria-hidden="true">▲</span> <span class="n">${t?.up ?? 0}</span><span class="sr"> up</span>
        </button>
        <button class="vote down" data-v="${esc(r.primary.videoId)}" data-dir="down" aria-pressed="false">
          <span aria-hidden="true">▼</span> <span class="n">${t?.down ?? 0}</span><span class="sr"> down</span>
        </button>
        <button class="say" data-v="${esc(r.primary.videoId)}">💬 SAY</button>`
        : '<span class="novid">No video for this one</span>';
      const kids = r.children.length
        ? `<details class="kids">
        <summary>+${r.children.length} more video${r.children.length === 1 ? '' : 's'} for this song</summary>
        ${r.children
          .map(
            (c) => `<div class="kid">
          <button class="thumb" data-v="${esc(c.videoId)}" aria-label="Play ${esc(c.videoTitle)}">
            ${thumbImg(c)}<span class="play" aria-hidden="true">▶</span>
          </button>
          <p class="vtitle">${esc(c.videoTitle)}</p>
        </div>`,
          )
          .join('\n')}
      </details>`
        : '';
      const said = (r.primary ? saidAbout.get(r.primary.videoId) ?? [] : [])
        .map((m) => `<li class="said"><b>${esc(m.playerName)}</b> ${esc(m.text)}</li>`)
        .join('\n');
      return `<li class="row">
    ${lead}
    <div class="meta">
      <p class="song">${esc(r.song)}</p>
      <p class="artist">${esc(r.artists)}</p>
      <div class="controls">
        <span class="prov" style="color:${PROV_INK[r.provenance]};border-color:${PROV_INK[r.provenance]}">${r.provenance}</span>
        ${controls}
      </div>
      ${said ? `<ul class="saids">${said}</ul>` : ''}
      ${kids}
    </div>
    ${stamp ? `<div class="stamp" aria-hidden="true">${stamp}</div>` : ''}
  </li>`;
    })
    .join('\n');

  const rosterHtml = roster
    .map((p) => `<button class="pick" data-id="${esc(p.id)}" data-name="${esc(p.name)}">${esc(p.name)}</button>`)
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
  --ink-0:#07090c;--ink-1:#0d1116;--ink-2:#141921;--ink-3:#1c232c;--line:#283039;
  --fg:#f1f4f7;--fg-2:#c2cad3;--fg-muted:#8b97a4;--fg-quiet:#5a6773;
  --pulp:#ff5b2e;--pulp-deep:#d94c23;--pulp-soft:#ff5b2e22;--bone:#faf7f2;
  --moss:#3ec27a;--amber:#e8a83a;--ember:#e6566c;--sky:#5aa3ff;
  --display:"Bricolage Grotesque",system-ui,sans-serif;
  --body:"Inter Tight",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,monospace;
}
*{margin:0;box-sizing:border-box}
body{background:var(--ink-0);color:var(--fg);font-family:var(--body);
  -webkit-font-smoothing:antialiased;padding:0 0 4rem}
.wrap{max-width:34rem;margin:0 auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}

header{position:relative;overflow:hidden;padding:14px 20px 20px;border-bottom:1px solid var(--line)}
/* The whole xerox hint: a halftone screen and a pulp glow, both far too faint
   to cost the header any contrast. Anything heavier belongs on the share art. */
header::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(circle,#0b0b0b 34%,transparent 36%);background-size:9px 9px;opacity:.05}
header::after{content:"";position:absolute;right:-30px;top:-30px;width:150px;height:150px;border-radius:50%;
  pointer-events:none;background:radial-gradient(circle,var(--pulp),transparent 70%);opacity:.14}
.idrow{position:relative;display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:14px}
.who{display:flex;align-items:center;gap:7px;background:var(--ink-2);border:1px solid var(--line);
  border-radius:999px;padding:4px 5px 4px 11px;min-height:44px}
.who .av{width:20px;height:20px;border-radius:50%;background:var(--pulp);color:var(--bone);font-size:10px;
  font-weight:800;display:flex;align-items:center;justify-content:center;font-family:var(--display)}
.who .lbl{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--fg-2)}
.who .lbl b{color:var(--fg)}
.who .chg{font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:var(--pulp);
  background:var(--pulp-soft);padding:2px 6px;border-radius:999px}
.playall{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--fg-quiet);text-decoration:none;
  display:flex;align-items:center;min-height:44px;padding:0 4px}
.playall:hover{color:var(--pulp)}
.tape{position:relative;display:inline-block;transform:rotate(-1.5deg);background:#e4dfd0;color:#141414;
  font-family:var(--mono);font-weight:700;font-size:10px;letter-spacing:.16em;padding:4px 12px;margin-bottom:10px;
  clip-path:polygon(0 12%,6% 0,94% 6%,100% 0,99% 90%,50% 100%,2% 92%);box-shadow:0 3px 8px rgba(0,0,0,.5)}
h1{position:relative;font-family:var(--display);font-weight:800;font-size:clamp(28px,9vw,38px);line-height:.92;
  letter-spacing:-.03em;text-wrap:balance}
.scrawl{display:block;width:200px;max-width:60%;height:11px;margin:3px 0 8px}
.sub{position:relative;font-size:13px;line-height:1.45;color:var(--fg-muted)}

.err{margin:12px 20px 0;border:1px solid var(--ember);color:var(--ember);border-radius:6px;
  padding:10px 12px;font-size:13px}
ol{list-style:none;padding:0;margin:0}
.row{position:relative;display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}
.thumb{position:relative;flex:0 0 88px;width:88px;height:58px;border-radius:6px;overflow:hidden;padding:0;
  line-height:0;background:var(--ink-2)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:22px;height:22px;
  border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:10px;line-height:1}
.thumb .num{position:absolute;left:5px;top:4px;font-family:var(--mono);font-size:9px;font-weight:700;color:#fff;
  text-shadow:0 1px 2px #000}
/* A video pulled from YouTube 404s its thumbnail; that is the only signal we
   get, and it arrives in the browser, so the placeholder is set by script. */
.thumb.gone{display:flex;align-items:center;justify-content:center;border:1px dashed var(--line)}
.thumb.gone img,.thumb.gone .play{display:none}
.thumb.gone::after{content:"✕";color:var(--fg-quiet);font-size:16px;line-height:1}
.meta{flex:1;min-width:0}
.song{font-weight:600;font-size:15px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.artist{font-size:12px;color:var(--fg-muted);margin:1px 0 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.prov{font-family:var(--mono);font-size:9px;letter-spacing:.1em;padding:2px 6px;border-radius:999px;
  border:1px solid currentColor}
/* F3 of the review: the prototype's 14px chips are unusable one-handed. The
   glyphs stay small; the button around them is a full target. */
.vote,.say{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:44px;min-width:44px;
  padding:0 8px;border-radius:8px;font-family:var(--mono);font-size:11px;color:var(--fg-muted)}
.vote.up span[aria-hidden]{color:var(--moss)}
.vote.down span[aria-hidden]{color:var(--ember)}
.say{margin-left:auto;font-size:9px;letter-spacing:.08em;color:var(--fg-quiet)}
/* Vote state is a border and a filled ground as well as a colour, because a
   count that only changed hue says nothing to a colour-blind reader. */
.vote[aria-pressed="true"]{background:var(--ink-3);box-shadow:inset 0 0 0 1px currentColor;color:var(--fg)}
.vote[disabled],.say[disabled]{opacity:.5;cursor:default}
.novid{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--fg-quiet)}
.kids{margin-top:8px}
.kids summary{font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:var(--fg-quiet);
  min-height:44px;display:flex;align-items:center;cursor:pointer}
.kid{display:flex;align-items:center;gap:10px;padding:6px 0 6px 14px;border-left:1px solid var(--line)}
.kid .thumb{flex:0 0 64px;width:64px;height:42px}
.vtitle{font-size:12px;color:var(--fg-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stamp{position:absolute;right:10px;top:10px;pointer-events:none}
.saids{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:5px}
.said{font-size:13px;line-height:1.4;color:var(--fg-2);border-left:2px solid var(--pulp);padding:2px 0 2px 9px}
.said b{color:var(--fg);font-weight:600}
.composer{display:flex;gap:8px;margin-top:8px}
.composer textarea{flex:1;min-width:0;background:var(--ink-1);border:1px solid var(--line);border-radius:6px;
  color:var(--fg);font:inherit;font-size:13px;padding:8px;resize:vertical}
.composer button{min-height:44px;padding:0 12px;border-radius:8px;background:var(--pulp);color:var(--ink-0);
  font-family:var(--mono);font-size:10px;letter-spacing:.12em;font-weight:700}
.pending{margin-top:8px;display:inline-block;font-family:var(--mono);font-size:9px;letter-spacing:.1em;
  color:var(--amber);border:1px solid var(--amber);border-radius:999px;padding:2px 6px}
.row.playing{flex-direction:column}
.row.playing iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:6px;display:block}
.empty{padding:2.5rem 20px;text-align:center;color:var(--fg-muted);font-size:14px}
footer{padding:16px 20px 26px;font-family:var(--mono);font-size:9px;letter-spacing:.06em;color:var(--fg-quiet);
  line-height:1.7}
footer a{color:var(--fg-muted)}
dialog{background:var(--ink-1);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:16px;
  max-width:20rem;width:calc(100% - 2rem)}
dialog::backdrop{background:rgba(7,9,12,.72)}
dialog h2{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--fg-muted);font-weight:400;
  margin-bottom:10px}
.pick{display:block;width:100%;text-align:left;min-height:44px;padding:0 10px;border-radius:8px;font-size:15px}
.pick:hover{background:var(--ink-3)}
</style>
</head><body>
<div class="wrap">
<header>
  <div class="idrow">
    <button class="who" id="who" aria-haspopup="dialog">
      <span class="av" id="who-av">?</span>
      <span class="lbl" id="who-lbl">WHO ARE YOU?</span>
      <span class="chg">CHANGE</span>
    </button>
    ${watchAll ? `<a class="playall" href="${esc(watchAll)}" target="_blank" rel="noreferrer">▶ PLAY ALL</a>` : ''}
  </div>
  <p class="tape">${esc(label)}</p>
  <h1>${esc(input.roundName)}</h1>
  <svg class="scrawl" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8 C30 3 50 12 78 6 C98 2 112 10 118 6" fill="none" stroke="var(--pulp)" stroke-width="2.4" stroke-linecap="round"/></svg>
  <p class="sub">${rows.length} song${rows.length === 1 ? '' : 's'} — watch them, thumb them, say something.</p>
</header>

<div class="err" id="err" hidden role="alert"></div>

${rows.length ? `<ol>\n${rowHtml}\n</ol>` : '<p class="empty">No videos for this round.</p>'}

<footer>
  Tap a thumbnail to watch it here.${guessed ? ` A machine guessed at the ${guessed} without a link. If one is wrong, that is why.` : ''}
  ${input.youtubeUrl ? `<br><a href="${esc(input.youtubeUrl)}" target="_blank" rel="noreferrer">Save to YouTube</a>` : ''}
  <br>Built by the Music League bot.
</footer>
</div>

<dialog id="roster"><h2>WHO ARE YOU?</h2>
${rosterHtml}
</dialog>

<script>
(function () {
  var API = ${jsLiteral(apiBase)};
  var SLUG = ${jsLiteral(input.slug)};
  var KEY = 'mlb.player';
  var who = document.getElementById('who');
  var dlg = document.getElementById('roster');
  var err = document.getElementById('err');

  function player() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function paintIdentity() {
    var p = player();
    document.getElementById('who-av').textContent = p ? p.name.charAt(0).toUpperCase() : '?';
    var lbl = document.getElementById('who-lbl');
    lbl.textContent = 'WHO ARE YOU?';
    if (!p) return;
    // The name comes back out of localStorage, so it is written as text and
    // never as markup.
    var b = document.createElement('b');
    b.textContent = p.name.toUpperCase();
    lbl.textContent = 'YOU ARE ';
    lbl.appendChild(b);
  }
  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }

  // Identity is never a gate: the list renders for anyone, and the picker only
  // opens when someone taps the chip or tries to write something.
  var pendingAction = null;
  function askWho(then) {
    pendingAction = then || null;
    if (!dlg.querySelector('.pick')) { fail('Nobody to pick from yet.'); return false; }
    dlg.showModal();
    return true;
  }
  function need(then) {
    var p = player();
    if (p) { then(p); return; }
    askWho(then);
  }
  who.addEventListener('click', function () { askWho(null); });
  dlg.addEventListener('click', function (ev) {
    var b = ev.target.closest('.pick');
    if (!b) return;
    var p = { id: b.dataset.id, name: b.dataset.name };
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: this session only */ }
    dlg.close();
    paintIdentity();
    // The local copy is authoritative — this only tells the server a name has
    // been claimed, so its failure must never raise the error strip.
    post('identity', { playerId: p.id }).catch(function () {});
    var next = pendingAction;
    pendingAction = null;
    if (next) next(p);
  });
  paintIdentity();

  // The page is a static file, so its tallies are frozen at render time —
  // without this, nobody ever sees anybody else's thumbs, and the whole point
  // of voting on a shared page is lost. Refresh them from the read model on
  // load. Failure is silent: the baked-in numbers are a fine fallback and an
  // error strip about counts would be noise.
  (function hydrate() {
    fetch(API + '/' + encodeURIComponent(SLUG), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (!m || !m.tallies) return;
        m.tallies.forEach(function (t) {
          document.querySelectorAll('.vote[data-v="' + CSS.escape(t.videoId) + '"]').forEach(function (b) {
            var n = b.querySelector('.n');
            if (n) n.textContent = b.dataset.dir === 'up' ? t.up : t.down;
          });
        });
      })
      .catch(function () {});
  })();

  function post(action, body) {
    return fetch(API + '/' + encodeURIComponent(SLUG) + '/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r;
    });
  }

  document.addEventListener('click', function (ev) {
    var thumb = ev.target.closest('.thumb');
    if (thumb && !thumb.classList.contains('gone')) return playHere(thumb);
    var vote = ev.target.closest('.vote');
    if (vote) return castVote(vote);
    var say = ev.target.closest('.say');
    if (say) return openComposer(say);
  });

  // Swap a thumbnail for the real player, one at a time, and only on demand —
  // a dozen autoloading iframes is a bad way to open a link on a phone.
  function playHere(btn) {
    var row = btn.closest('.row');
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + btn.dataset.v + '?autoplay=1&rel=0';
    f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    f.title = row.querySelector('.song').textContent;
    row.classList.add('playing');
    btn.replaceWith(f);
  }

  function castVote(btn) {
    need(function (p) {
      var on = btn.getAttribute('aria-pressed') === 'true';
      var other = btn.closest('.controls').querySelector('.vote' + (btn.classList.contains('up') ? '.down' : '.up'));
      var n = btn.querySelector('.n');
      // Optimistic: the count is a tally of other people's taps that we cannot
      // re-read without a reload, so we adjust ours and put it back on failure.
      var before = { mine: on, count: +n.textContent, otherOn: other.getAttribute('aria-pressed') === 'true',
                     otherCount: +other.querySelector('.n').textContent };
      btn.setAttribute('aria-pressed', on ? 'false' : 'true');
      n.textContent = before.count + (on ? -1 : 1);
      if (!on && before.otherOn) {
        other.setAttribute('aria-pressed', 'false');
        other.querySelector('.n').textContent = before.otherCount - 1;
      }
      post('vote', { videoId: btn.dataset.v, playerId: p.id, dir: on ? null : (btn.classList.contains('up') ? 'up' : 'down') })
        .catch(function () {
          btn.setAttribute('aria-pressed', before.mine ? 'true' : 'false');
          n.textContent = before.count;
          other.setAttribute('aria-pressed', before.otherOn ? 'true' : 'false');
          other.querySelector('.n').textContent = before.otherCount;
          fail('That vote did not save. Try again in a moment.');
        });
    });
  }

  function openComposer(btn) {
    need(function (p) {
      var meta = btn.closest('.meta');
      if (meta.querySelector('.composer')) return;
      var form = document.createElement('form');
      form.className = 'composer';
      form.innerHTML = '<textarea rows="2" maxlength="400" placeholder="Say something about this one"></textarea>'
        + '<button type="submit">SEND</button>';
      meta.appendChild(form);
      form.querySelector('textarea').focus();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var text = form.querySelector('textarea').value.trim();
        if (!text) return;
        var send = form.querySelector('button');
        send.disabled = true;
        send.textContent = 'SEND…';
        post('message', { videoId: btn.dataset.v, playerId: p.id, text: text })
          .then(function () {
            // Messages queue for Matt; nothing has reached the group yet, and
            // saying otherwise would be a lie people act on.
            var chip = document.createElement('p');
            chip.className = 'pending';
            chip.textContent = '⏳ WITH MATT';
            form.replaceWith(chip);
          })
          .catch(function () {
            send.disabled = false;
            send.textContent = 'SEND';
            fail('That message did not send. Try again in a moment.');
          });
      });
    });
  }

  // Thumbnail errors do not bubble, so this listens in the capture phase.
  document.addEventListener('error', function (ev) {
    var img = ev.target;
    if (img.tagName !== 'IMG') return;
    var thumb = img.closest('.thumb');
    if (!thumb || thumb.classList.contains('gone')) return;
    thumb.classList.add('gone');
    // Only the primary carries the note; a dead child is already labelled by
    // its own title inside the disclosure.
    var meta = img.closest('.kid') ? null : thumb.parentElement.querySelector('.meta');
    if (meta && !meta.querySelector('.novid')) {
      var note = document.createElement('span');
      note.className = 'novid';
      note.textContent = 'No video for this one';
      meta.querySelector('.controls').appendChild(note);
    }
  }, true);
})();
</script>
</body></html>`;
}

/** Write the page and return its public path segment. */
export function writePlaylistPage(slug: string, input: PlaylistPageInput): string {
  const dir = path.join(DIGESTS_DIR, 'p', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildPlaylistPageHtml({ ...input, slug }));
  return `/p/${slug}/`;
}
