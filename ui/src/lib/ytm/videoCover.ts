import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import type { VideoPick } from './videoReview.js';

/**
 * Cover art for the music-video playlist — the "heavy xerox" concept from the
 * Claude Design handoff (design/YouTube Playlist WhatsApp Design.zip, variant
 * `grunge3`), reviewed in design/mlb-playlist-handoff-review.md.
 *
 * A torn, photocopied flyer on the app's dark/pulp surface. Deliberately a
 * different *object* from the audio drop cover (scripts/ytm-cover/generate.mjs)
 * so the two never read as the same thing in the same chat.
 *
 * Everything is deterministic CSS/SVG — the toner grain and roughened edges are
 * feTurbulence, not images — so a round renders the same way twice.
 *
 * DEVIATION FROM THE HANDOFF (finding F1 of the review): the packet hard-coded
 * "I WANT MY" over "MTV" at a fixed 44cqw, tuned so exactly three letters filled
 * the sheet. That is R143's round name, not a template — rendered with R141's
 * real title it overflowed the sheet on both axes and was unreadable.
 *
 * What the design actually *is*, though, is a small setup over a big payoff word,
 * which is how these round names read anyway. So the name is split rather than
 * shrunk: the last word or two becomes the giant headline, everything before it
 * becomes the kicker, and both are fitted by measurement. R143 comes out as the
 * designed poster ("I WANT MY" / huge "MTV"); "More Cowbell!" becomes MORE /
 * COWBELL!; "…Captain Jack Sparrow" becomes a long kicker over JACK SPARROW.
 */

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const FONTS_CSS = path.join(process.env.DIGESTS_DIR ?? '/app/digests', 'd/boarz-chat-superlatives/_app/fonts.css');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Split a round name into the flyer's two parts: a small kicker and the big
 * payoff word underneath it.
 *
 * Takes the last word as the payoff, unless it is short enough to look silly
 * alone ("MTV" is fine; "of" is not), in which case it takes the last two. A
 * one-word round name is all payoff and no kicker.
 */
export function splitHeadline(roundName: string): { kicker: string; punch: string } {
  const words = roundName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { kicker: '', punch: (words[0] ?? '').toUpperCase() };
  // A 1-2 character last word ("TV", "It") reads as a fragment on its own line.
  const takeTwo = words[words.length - 1].replace(/[^A-Za-z0-9]/g, '').length <= 2;
  const n = takeTwo && words.length > 2 ? 2 : 1;
  return {
    kicker: words.slice(0, words.length - n).join(' ').toUpperCase(),
    punch: words.slice(words.length - n).join(' ').toUpperCase(),
  };
}

export interface VideoCoverInput {
  roundName: string;
  leagueTitle: string;
  /** Only the picks that are actually in the playlist. */
  picks: VideoPick[];
  /** Round number within the league, when known — renders as "· R143". */
  roundNumber?: number | null;
  /**
   * Total playlist runtime in whole minutes, when known — renders as a stamp.
   * Null/undefined omits the stamp entirely. This field replaced a hardcoded
   * "120 MIN": an absent stamp is always better than a wrong one.
   */
  runtimeMin?: number | null;
}

export interface RenderDeps {
  outPath?: string;
  fontsCss?: string;
  chromePath?: string;
}

/** Toner grain, as an inline SVG data URI. Two passes: lift specks, drop grime. */
function tonerLayer(baseFrequency: number, octaves: number, sizeCqw: number, opacity: number, blend: 'screen' | 'multiply'): string {
  const svg =
    `%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E` +
    `%3Cfilter id='t'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='${octaves}'/%3E` +
    `%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E` +
    `%3Crect width='90' height='90' filter='url(%23t)'/%3E%3C/svg%3E`;
  return `<div style="position:absolute;inset:0;pointer-events:none;background:url(&quot;data:image/svg+xml,${svg}&quot;);background-size:${sizeCqw}cqw ${sizeCqw}cqw;opacity:${opacity};mix-blend-mode:${blend}"></div>`;
}

/**
 * The flyer. `titleFontCqw` and `kickerText` are supplied by the fitting pass —
 * see renderVideoCover; buildVideoCoverHtml itself is pure.
 */
export function buildVideoCoverHtml(
  input: VideoCoverInput,
  fontsCssHref: string,
  fit: { titleCqw: number; titleTopCqw: number } = { titleCqw: 44, titleTopCqw: 24 },
): string {
  const { kicker, punch } = splitHeadline(input.roundName);
  const stamp = [input.leagueTitle.toUpperCase(), input.roundNumber ? `R${input.roundNumber}` : null]
    .filter(Boolean)
    .join(' · ');

  // Omitted rather than guessed when the runtime is unknown — see VideoCoverInput.
  const runtimeStamp =
    typeof input.runtimeMin === 'number' && Number.isFinite(input.runtimeMin) && input.runtimeMin > 0
      ? `<div style="position:absolute;right:4cqw;top:10cqw;transform:rotate(6deg);border:.55cqw solid #121212;color:#121212;font-family:var(--font-mono);font-weight:700;font-size:4cqw;letter-spacing:.1em;padding:.8cqw 1.6cqw;filter:url(#xr2)">${esc(String(Math.round(input.runtimeMin)))} MIN</div>`
      : '';

  // Two stacked copies of the same text: a pulp ghost offset behind black ink.
  // That is a misregistered colour plate, the flyer's core visual idea.
  const titleBlock = (color: string, extra: string) =>
    `<div style="position:absolute;left:5cqw;right:5cqw;top:${fit.titleTopCqw}cqw;font-weight:800;font-size:${fit.titleCqw}cqw;` +
    `line-height:.78;color:${color};letter-spacing:-.06em;filter:url(#xr2);${extra}" id="fit-title">${esc(punch)}</div>`;

  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${fontsCssHref}">
<style>
:root{
  --ink-0:#07090c;--mash-pulp:#ff5b2e;
  --font-display:"Bricolage Grotesque",system-ui,sans-serif;
  --font-body:"Inter Tight",system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
}
*{margin:0;box-sizing:border-box}
body{width:640px;height:640px;overflow:hidden}
.sq{container-type:inline-size;width:640px;height:640px;position:relative;overflow:hidden;
    background:#000;font-family:var(--font-display);line-height:1}
</style>
<body><div class="sq">
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="xr2" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.8" xChannelSelector="R" yChannelSelector="G"/></filter></svg>

  <div style="position:absolute;inset:0;background:radial-gradient(120% 100% at 70% 0%,#241610 0%,var(--ink-0) 58%)"></div>
  <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.03) 0 1px,transparent 1px 7cqw)"></div>
  <div style="position:absolute;right:-10cqw;top:-10cqw;width:50cqw;height:50cqw;border-radius:50%;background:radial-gradient(circle,var(--mash-pulp) 0,transparent 70%);opacity:.32"></div>

  <!-- torn underside, peeking above the tear -->
  <div style="position:absolute;left:4cqw;top:3.4cqw;width:92cqw;height:84cqw;transform:rotate(-1.5deg);background:#c7c0ad;clip-path:polygon(0 9%,4% 4%,9% 10%,14% 3%,19% 9%,25% 4%,31% 11%,37% 4%,43% 10%,49% 3%,55% 9%,61% 4%,67% 10%,73% 3%,79% 9%,85% 4%,91% 10%,96% 4%,100% 9%,100% 100%,0 100%)"></div>

  <!-- the sheet: torn along the top edge only -->
  <div id="sheet" style="position:absolute;left:4cqw;top:6cqw;width:92cqw;height:82cqw;transform:rotate(-1.5deg);background:#e7e2d4;box-shadow:0 5cqw 11cqw rgba(0,0,0,.7);clip-path:polygon(0 6%,3% 3%,6% 8%,9% 2%,13% 7%,16% 3%,20% 9%,24% 4%,28% 8%,32% 2%,36% 6%,40% 3%,44% 9%,48% 4%,52% 7%,56% 2%,60% 8%,64% 4%,68% 9%,72% 3%,76% 7%,80% 2%,84% 8%,88% 4%,92% 7%,96% 2%,100% 5%,100% 100%,0 100%)">
    <div style="position:absolute;inset:0;background:radial-gradient(circle,#0b0b0b 36%,transparent 38%);background-size:2cqw 2cqw;opacity:.2"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:10cqw;background:linear-gradient(180deg,rgba(0,0,0,.3),transparent)"></div>
    <div style="position:absolute;left:0;right:0;top:48%;height:2cqw;background:linear-gradient(180deg,rgba(0,0,0,.14),transparent);transform:skewY(-1.5deg)"></div>
    <div style="position:absolute;left:0;right:0;top:74%;height:2cqw;background:linear-gradient(180deg,rgba(0,0,0,.12),transparent);transform:skewY(1deg)"></div>

    <!-- highlighter slash behind the kicker -->
    <div id="hl" style="position:absolute;left:5cqw;top:15cqw;width:52cqw;height:8cqw;background:var(--mash-pulp);opacity:.55;transform:rotate(-3deg);mix-blend-mode:multiply"></div>
    <div id="fit-kicker" style="position:absolute;left:6cqw;right:30cqw;top:13.5cqw;font-family:var(--font-mono);font-weight:700;font-size:8cqw;color:#121212;transform:rotate(-3deg);letter-spacing:-.02em;filter:url(#xr2);line-height:1.05">${esc(kicker || 'THE VIDEOS')}</div>

    ${titleBlock('var(--mash-pulp)', 'transform:translate(1.8cqw,1.6cqw) rotate(-1deg);opacity:.8')}
    ${titleBlock('#111', 'transform:rotate(-1deg)')}

    <svg id="scrawl" viewBox="0 0 100 30" preserveAspectRatio="none" style="position:absolute;left:4cqw;top:60cqw;width:78cqw;height:12cqw;overflow:visible"><path d="M2 14 C24 6 40 20 60 12 C78 5 92 18 98 10" fill="none" stroke="var(--mash-pulp)" stroke-width="3" stroke-linecap="round"/></svg>

    ${runtimeStamp}
    <div style="position:absolute;left:-4cqw;top:16cqw;width:26cqw;height:6.5cqw;background:rgba(206,200,178,.72);border-left:1px dashed rgba(0,0,0,.25);border-right:1px dashed rgba(0,0,0,.25);transform:rotate(-22deg)"></div>
    <div style="position:absolute;right:-3cqw;top:44cqw;width:24cqw;height:6.5cqw;background:rgba(206,200,178,.72);border-left:1px dashed rgba(0,0,0,.25);border-right:1px dashed rgba(0,0,0,.25);transform:rotate(-14deg)"></div>

    ${tonerLayer(0.9, 2, 36, 0.62, 'screen')}
    ${tonerLayer(0.5, 3, 64, 0.4, 'multiply')}
  </div>

  <div style="position:absolute;left:0;right:0;bottom:2.5cqw;text-align:center;color:var(--mash-pulp);font-family:var(--font-mono);font-weight:700;font-size:4.6cqw;letter-spacing:.16em;transform:rotate(-1.5deg)">${esc(stamp)}</div>
</div></body>`;
}

/**
 * Fit the headline to the sheet, in the browser, after fonts have loaded.
 *
 * Done by measurement rather than by guessing from character count: the three
 * fonts are proportional and a round name is anything from "MTV" to "This is
 * the Tale of Captain Jack Sparrow". Shrinks until the type fits the space
 * between the kicker and the scrawl, then nudges the block down so short
 * headlines sit where the designed one did instead of floating.
 */
const FIT_IN_PAGE = `(() => {
  const sheet = document.getElementById('sheet');
  const punch = [...document.querySelectorAll('#fit-title')];
  const kicker = document.getElementById('fit-kicker');
  const hl = document.getElementById('hl');
  if (!sheet || !punch.length) return null;
  const cq = sheet.parentElement.clientWidth / 100;   // 1cqw in px
  // Overflow is tested against each element's OWN box, not a computed width:
  // these blocks are pinned with left+right, so scrollWidth reports the box
  // width no matter how small the type is, and comparing it to a derived
  // "available width" is true forever — which silently drove every round to
  // the minimum font size.
  const overflows = (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

  // 1. Kicker: shrink until it fits ONE line, down to a floor. A long setup
  //    ("THIS IS THE TALE OF CAPTAIN JACK") has to give way to the payoff.
  let kSize = 8;
  if (kicker) {
    // The kicker's box stops short of the top-right corner (right:30cqw), so a
    // long setup shrinks to fit rather than running into it — which it did for
    // "THIS IS THE TALE OF CAPTAIN JACK" and turned both to mush. The runtime
    // stamp that used to sit there was removed (it was the hardcoded string
    // "120 MIN" — a false claim on every cover ever sent); the space stays
    // reserved for the real runtime that replaces it.
    kicker.style.whiteSpace = 'nowrap';
    while (kSize > 2.6 && kicker.scrollWidth > kicker.clientWidth + 1) {
      kSize -= 0.2;
      kicker.style.fontSize = kSize + 'cqw';
    }
    // Track the highlighter slash to whatever the kicker actually measures.
    if (hl) { hl.style.width = Math.min(88, kicker.scrollWidth / cq + 3) + 'cqw'; hl.style.height = (kSize * 1.15) + 'cqw'; }
  }

  // 2. Payoff: as big as the sheet allows, between the kicker and the scrawl.
  const topCqw = kSize > 5 ? 24 : 21;
  const availH = (60 - topCqw - 1) * cq;
  let size = 44;
  const set = (v) => punch.forEach((t) => {
    t.style.fontSize = v + 'cqw';
    t.style.height = availH + 'px';
  });
  set(size);
  // 6cqw floor: below that the xerox displacement filter eats the letterforms.
  while (size > 6 && overflows(punch[0])) {
    size -= 0.5;
    set(size);
  }
  // Height was only a measuring harness; let it hug the type again.
  punch.forEach((t) => (t.style.height = 'auto'));

  // 3. Re-centre the payoff in the space it actually occupies, so a short word
  //    sits where the designed one did instead of floating.
  const used = punch[0].scrollHeight / cq;
  const top = topCqw + Math.max(0, ((60 - topCqw) - used) / 2 - 1);
  punch.forEach((t) => (t.style.top = top + 'cqw'));
  return { titleCqw: size, titleTopCqw: top, kickerCqw: kSize };
})()`;

/**
 * Render the cover to a PNG under DATA_DIR/tmp and return BOTH paths: the one
 * this container wrote, and the one the bot container will read. Same shared
 * volume, different mount points.
 */
export async function renderVideoCover(
  roundId: number, input: VideoCoverInput, deps: RenderDeps = {},
): Promise<{ hostPath: string; botPath: string; fit: { titleCqw: number; titleTopCqw: number; kickerCqw: number } }> {
  const out = deps.outPath ?? path.join(DATA_DIR, 'tmp', `r${roundId}-videos-cover.png`);
  const fontsCss = deps.fontsCss ?? FONTS_CSS;
  const fontsHref = fs.existsSync(fontsCss) ? pathToFileURL(fontsCss).href : '';

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmpHtml = out.replace(/\.png$/, '.html');
  fs.writeFileSync(tmpHtml, buildVideoCoverHtml(input, fontsHref));

  const browser = await puppeteer.launch({
    executablePath: deps.chromePath ?? CHROME,
    args: ['--no-sandbox'],
  });
  let fit = { titleCqw: 44, titleTopCqw: 24, kickerCqw: 8 };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const measured = (await page.evaluate(FIT_IN_PAGE)) as typeof fit | null;
    if (measured) fit = measured;
    await page.screenshot({ path: out });
  } finally {
    await browser.close();
    fs.rmSync(tmpHtml, { force: true });
  }

  return { hostPath: out, botPath: `/app/data/tmp/${path.basename(out)}`, fit };
}
