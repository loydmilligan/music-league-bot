import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import type { VideoPick } from './videoReview.js';

/**
 * Cover art for the music-video playlist.
 *
 * A deliberately different object from the audio drop cover
 * (scripts/ytm-cover/generate.mjs, variants 1a-1e): that one is album art and
 * says "listen to this". This one is YouTube thumbnails and has a job the audio
 * cover never has — being honest that a machine guessed some of these. Hence
 * the stamp, and the "N hand-picked / N best guess" split in the footer.
 *
 * Rendered HERE rather than by the host generator because the contents are not
 * known until a human approves them, and bot-ui is what handles approval. It
 * has chromium and puppeteer-core; the host script's renderer is unreachable
 * from inside the container.
 */

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const FONTS_CSS = path.join(process.env.DIGESTS_DIR ?? '/app/digests', 'd/boarz-chat-superlatives/_app/fonts.css');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline every thumbnail up front so the render never races the network. */
async function thumbDataUri(videoId: string, fetchFn: typeof fetch): Promise<string | null> {
  // mqdefault is the smallest size that always exists; maxres often 404s.
  for (const name of ['mqdefault', 'hqdefault']) {
    try {
      const r = await fetchFn(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      // YouTube serves a 120x90 grey placeholder for a dead id; skip it.
      if (buf.byteLength < 2000) continue;
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      /* try the next size */
    }
  }
  return null;
}

export interface VideoCoverInput {
  roundName: string;
  leagueTitle: string;
  /** Only the picks that are actually in the playlist. */
  picks: VideoPick[];
}

export interface RenderDeps {
  fetchFn?: typeof fetch;
  outPath?: string;
  fontsCss?: string;
}

export function buildVideoCoverHtml(
  input: VideoCoverInput, thumbs: Array<string | null>, fontsCssHref: string,
): string {
  // Counted in VIDEOS, not songs: the footer number has to match the playlist.
  const total = input.picks.reduce((n, p) => n + p.chosen.length, 0);
  const handPicked = input.picks
    .filter((p) => p.source === 'comment')
    .reduce((n, p) => n + p.chosen.length, 0);
  const guessed = total - handPicked;

  // Tile whatever we have to fill 16 cells so no cell is ever blank, exactly as
  // the audio cover's gridFill does for short rounds.
  const usable = thumbs.filter((t): t is string => !!t);
  const cells = Array.from({ length: 16 }, (_, i) =>
    usable.length
      ? `<img src="${usable[i % usable.length]}" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="background:var(--mash-pulp-edge)"></div>`,
  ).join('');

  // The footer line IS the accuracy disclaimer — a count of what a human chose
  // versus what search guessed says it better than an adjective.
  const provenance = guessed === 0
    ? 'every one hand-picked'
    : handPicked === 0
      ? `${guessed} best guess${guessed === 1 ? '' : 'es'}`
      : `${handPicked} hand-picked · ${guessed} best guess${guessed === 1 ? '' : 'es'}`;

  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${fontsCssHref}">
<style>
:root{--ink-0:#07090c;--ink-3:#1c232c;--fg:#f1f4f7;--fg-muted:#8b97a4;
--mash-pulp:#ff5b2e;--mash-pulp-deep:#d94c23;--mash-pulp-edge:#8a2d15;--bone:#faf7f2;
--font-display:"Bricolage Grotesque",sans-serif;--font-body:"Inter Tight",sans-serif;--font-mono:"JetBrains Mono",monospace}
*{margin:0;box-sizing:border-box}
body{width:640px;height:640px;background:var(--ink-0);overflow:hidden;position:relative;font-family:var(--font-body);color:var(--fg)}
/* Scanlines: the one nod to "this is video, not audio". */
.scan{position:absolute;inset:0;background:repeating-linear-gradient(to bottom,rgba(0,0,0,.28) 0 2px,transparent 2px 4px);mix-blend-mode:multiply}
</style>
<body>
  <div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr">${cells}</div>
  <div class="scan"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(88% 88% at 50% 46%, rgba(7,9,12,.20), rgba(7,9,12,.88))"></div>

  <!-- Rubber stamp: rectangular and tilted the other way, so it never reads as
       the audio cover's round medallion at thumbnail size. -->
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
    <div style="transform:rotate(-6deg);border:5px double var(--mash-pulp);padding:20px 34px 16px;text-align:center;
                background:rgba(7,9,12,.44);box-shadow:0 0 0 10px rgba(255,91,46,.09)">
      <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;letter-spacing:.30em;color:var(--bone);opacity:.85">▶ ▶ ▶</div>
      <div style="font-family:var(--font-display);font-weight:800;font-style:italic;font-size:66px;line-height:1;letter-spacing:-.03em;
                  color:var(--mash-pulp);text-shadow:0 3px 0 var(--mash-pulp-edge);margin:6px 0 8px">THE VIDEOS</div>
      <div style="font-family:var(--font-mono);font-weight:700;font-size:13px;letter-spacing:.16em;color:var(--bone)">ACCURACY NOT GUARANTEED</div>
    </div>
  </div>

  <div style="position:absolute;top:0;left:0;right:0;padding:16px 20px;background:linear-gradient(rgba(7,9,12,.78),transparent)">
    <span style="font-family:var(--font-mono);font-weight:700;font-size:14px;letter-spacing:.14em;color:var(--mash-pulp)">${esc(input.leagueTitle).toUpperCase()}</span>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;padding:22px 24px 20px;background:linear-gradient(transparent,rgba(7,9,12,.92) 42%)">
    <h1 style="font-family:var(--font-display);font-weight:800;font-size:34px;line-height:1.03;letter-spacing:-.02em;color:var(--fg);text-wrap:balance">${esc(input.roundName)}</h1>
    <p style="font-family:var(--font-mono);font-weight:600;font-size:14px;letter-spacing:.10em;color:var(--fg-muted);margin-top:8px">
      ${total} VIDEO${total === 1 ? '' : 'S'} · ${esc(provenance).toUpperCase()}
    </p>
  </div>
</body>`;
}

/**
 * Render the cover to a PNG under DATA_DIR/tmp and return BOTH paths: the one
 * this container wrote, and the one the bot container will read. They are the
 * same shared volume but the caller must hand the bot ITS path.
 */
export async function renderVideoCover(
  roundId: number, input: VideoCoverInput, deps: RenderDeps = {},
): Promise<{ hostPath: string; botPath: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const out = deps.outPath ?? path.join(DATA_DIR, 'tmp', `r${roundId}-videos-cover.png`);
  const fontsCss = deps.fontsCss ?? FONTS_CSS;

  // One thumbnail per selected video, not per song — a song contributing two
  // videos should show up twice in the grid, because it does in the playlist.
  const ids = input.picks.flatMap((p) => p.chosen);
  const thumbs = await Promise.all(ids.map((id) => thumbDataUri(id, fetchFn)));
  const fontsHref = fs.existsSync(fontsCss) ? pathToFileURL(fontsCss).href : '';
  const html = buildVideoCoverHtml(input, thumbs, fontsHref);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmpHtml = out.replace(/\.png$/, '.html');
  fs.writeFileSync(tmpHtml, html);

  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out });
  } finally {
    await browser.close();
    fs.rmSync(tmpHtml, { force: true });
  }

  return { hostPath: out, botPath: `/app/data/tmp/${path.basename(out)}` };
}
