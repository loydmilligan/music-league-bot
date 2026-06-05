import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { getDb } from '$lib/db/client.js';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const APP_INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;
const EXPORTS_DIR = join(process.env.DATA_DIR || '/app/data', 'exports');

// sprint-20 html-share: where self-contained interactive digests are written
// (shared volume; digest-static serves it read-only). Public base is the
// separate no-Access Cloudflare tunnel.
const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const PUBLIC_DIGEST_BASE = (process.env.PUBLIC_DIGEST_BASE_URL || 'https://digest.mattmariani.com').replace(/\/+$/, '');

// WIDE = desktop broadsheet (800px). MOBILE = phone-portrait card (430px via the
// dg-export--mobile class the page applies when ?format=mobile). The viewport is
// a little wider than the card so the page's own padding can't clip the element
// screenshot; deviceScaleFactor 3 keeps the narrower card crisp.
const VIEWPORT_WIDTH = 800;
const MOBILE_VIEWPORT_WIDTH = 520;

// PDF page box — phone-portrait, narrow enough that the 430px mobile card fits
// with margins (no horizontal scroll), tall enough to read as a "page" while
// Chromium paginates long digests across multiple pages.
const PDF_PAGE_WIDTH = '460px';
const PDF_PAGE_HEIGHT = '860px';
const PDF_MARGIN = '14px';

// CSS injected into every export render to strip the interactive chrome that
// lives outside (or is overlaid on) the .dg-export region.
const HIDE_CHROME_CSS = `
  .dg-pipe, .dg-pipeline, .dg-pipe-strip,
  .dg-section-actions, .dg-section-banner, .dg-variant-switch,
  .dg-whole-regen, .dg-page-actions, [data-export-hide="1"] { display: none !important; }
`;

export type DigestExportFormat = 'mobile' | 'wide' | 'pdf' | 'png-sections';

export interface ExportFile {
  filename: string;
  absPath: string;
  bytes: number;
  contentType: 'image/png' | 'application/pdf';
  /** Short human label for the export-action UI (e.g. "Mobile PNG", "Podium"). */
  label: string;
}

// Back-compat alias — finalize used to import ExportResult.
export type ExportResult = ExportFile;

function tsStamp(): number {
  return Math.floor(Date.now() / 1000);
}

async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: EXEC_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

// Load the digest page in the given on-screen format, wait for the export
// region, and strip chrome. Returns the page ready for screenshot / pdf.
async function loadDigest(browser: Browser, roundId: number, format: 'mobile' | 'wide'): Promise<Page> {
  const isMobile = format === 'mobile';
  const page = await browser.newPage();
  await page.setViewport({
    width: isMobile ? MOBILE_VIEWPORT_WIDTH : VIEWPORT_WIDTH,
    height: 1200,
    deviceScaleFactor: isMobile ? 3 : 2,
  });
  const url = `${APP_INTERNAL_URL}/digest/${roundId}?export=1&format=${format}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
  if (!resp || !resp.ok()) {
    throw new Error(`page load failed: ${resp?.status() ?? 'no-response'} ${url}`);
  }
  await page.waitForSelector('.dg-export', { timeout: 10_000 });
  await page.addStyleTag({ content: HIDE_CHROME_CSS });
  return page;
}

// ---- PNG: full digest (mobile / wide) — the original export ----
export async function renderDigestPng(
  roundId: number,
  format: 'mobile' | 'wide' = 'mobile',
): Promise<ExportFile> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const filename = `r-${roundId}-digest-${tsStamp()}.png`;
  const absPath = join(EXPORTS_DIR, filename);

  const browser = await launch();
  try {
    const page = await loadDigest(browser, roundId, format);
    const handle = await page.$('.dg-export');
    if (!handle) throw new Error('.dg-export not found in rendered page');
    const png = (await handle.screenshot({ type: 'png', omitBackground: false })) as Buffer;
    await writeFile(absPath, png);
    return {
      filename,
      absPath,
      bytes: png.length,
      contentType: 'image/png',
      label: format === 'mobile' ? 'Mobile PNG' : 'Wide PNG',
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- PDF: phone-portrait, paginated, crisp/selectable text (primary share) ----
export async function renderDigestPdf(roundId: number): Promise<ExportFile> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const filename = `r-${roundId}-digest-${tsStamp()}.pdf`;
  const absPath = join(EXPORTS_DIR, filename);

  const browser = await launch();
  try {
    const page = await loadDigest(browser, roundId, 'mobile');
    // Keep the on-screen (dark) styling in the PDF, and add print-fragmentation
    // rules so sections don't split awkwardly across page breaks. Drop the
    // card's centering / shadow so it fills the printable width cleanly.
    await page.emulateMediaType('screen');
    await page.addStyleTag({
      content: `
        html, body { background: var(--bg) !important; }
        .dg-page { padding: 0 !important; background: var(--bg) !important; }
        .dg-export { width: auto !important; margin: 0 !important;
                     box-shadow: none !important; border-radius: 0 !important; border: 0 !important; }
        .dg-section-wrap, .dgC-track, .dgC-quote, .dgC-consensus-row, .dgC-mast, .dgC-foot {
          break-inside: avoid;
        }
      `,
    });
    const pdf = (await page.pdf({
      printBackground: true,
      width: PDF_PAGE_WIDTH,
      height: PDF_PAGE_HEIGHT,
      margin: { top: PDF_MARGIN, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN },
    })) as Buffer;
    await writeFile(absPath, pdf);
    return { filename, absPath, bytes: pdf.length, contentType: 'application/pdf', label: 'PDF (phone)' };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- PNG per section (+ a dedicated podium-only image) ----
export async function renderDigestSectionPngs(roundId: number): Promise<ExportFile[]> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const ts = tsStamp();
  const out: ExportFile[] = [];

  const browser = await launch();
  try {
    const page = await loadDigest(browser, roundId, 'mobile');
    const wraps = await page.$$('.dg-export .dg-section-wrap');
    if (!wraps.length) throw new Error('no .dg-section-wrap elements found');

    let idx = 0;
    let podiumHandle: (typeof wraps)[number] | null = null;
    for (const handle of wraps) {
      const kind = (await handle.evaluate((el) => el.getAttribute('data-section-kind') || 'section')) as string;
      const safeKind = kind.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'section';
      const filename = `r-${roundId}-digest-${ts}-${idx}-${safeKind}.png`;
      const absPath = join(EXPORTS_DIR, filename);
      const png = (await handle.screenshot({ type: 'png', omitBackground: false })) as Buffer;
      await writeFile(absPath, png);
      out.push({ filename, absPath, bytes: png.length, contentType: 'image/png', label: `${idx + 1}. ${safeKind}` });
      if (safeKind === 'podium' && !podiumHandle) podiumHandle = handle;
      idx++;
    }

    // Dedicated podium-only share image (separate file, clearly named).
    if (podiumHandle) {
      const filename = `r-${roundId}-digest-${ts}-podium.png`;
      const absPath = join(EXPORTS_DIR, filename);
      const png = (await podiumHandle.screenshot({ type: 'png', omitBackground: false })) as Buffer;
      await writeFile(absPath, png);
      out.push({ filename, absPath, bytes: png.length, contentType: 'image/png', label: 'Podium (share)' });
    }

    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- Unified dispatcher: always returns an array of files ----
export async function runDigestExport(roundId: number, format: DigestExportFormat): Promise<ExportFile[]> {
  switch (format) {
    case 'pdf':
      return [await renderDigestPdf(roundId)];
    case 'png-sections':
      return renderDigestSectionPngs(roundId);
    case 'wide':
      return [await renderDigestPng(roundId, 'wide')];
    case 'mobile':
    default:
      return [await renderDigestPng(roundId, 'mobile')];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// HTML share (sprint-20) — render the LIVE interactive digest into a
// self-contained folder-per-slug artifact servable from a dumb static host.
// Mechanism decided by the packaging-spike: capture the SSR document + the
// same-origin /_app/ asset closure a real (hydrated, interactivity-ON) page
// load fetches, rewrite the page→entry refs ../_app → ./_app, localize fonts,
// drop root-absolute icon/manifest refs, neutralize the layout auth probe.
// ───────────────────────────────────────────────────────────────────────────

export interface HtmlShareResult {
  slug: string;
  /** Public share URL — https://digest.mattmariani.com/d/<slug> */
  url: string;
  /** On-disk artifact directory in the shared digests/ volume. */
  dir: string;
  bytes: number;
  files: number;
}

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Stable, unguessable slug per round (PK = round_id → one slug forever; re-render
// overwrites in place so shared links never break).
function getOrCreateShareSlug(roundId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT slug FROM digest_shares WHERE round_id = ?').get(roundId) as
    | { slug: string }
    | undefined;
  if (row?.slug) return row.slug;
  const slug = randomBytes(12).toString('base64url'); // 16 url-safe chars, non-enumerable
  db.prepare(
    `INSERT INTO digest_shares (round_id, slug) VALUES (?, ?)
     ON CONFLICT(round_id) DO NOTHING`,
  ).run(roundId, slug);
  // Re-read in case of a concurrent insert winning the race.
  const after = db.prepare('SELECT slug FROM digest_shares WHERE round_id = ?').get(roundId) as {
    slug: string;
  };
  return after.slug;
}

function touchShare(roundId: number): void {
  getDb()
    .prepare(`UPDATE digest_shares SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE round_id = ?`)
    .run(roundId);
}

// Fetch the Google-Fonts CSS the app links, pull every woff2 it references into
// the asset map under /_app/fonts/, and return the CSS rewritten to point at the
// local copies (relative to _app/fonts.css). Returns null if no font link found
// or the network is unreachable — the artifact still works (system fonts).
async function localizeFonts(html: string, assets: Map<string, Buffer>): Promise<string | null> {
  const m = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s]+/);
  if (!m) return null;
  const cssUrl = m[0].replace(/&amp;/g, '&');
  try {
    let css = await (await fetch(cssUrl, { headers: { 'User-Agent': CHROME_UA } })).text();
    const fontUrls = [...new Set([...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)'"]+\.woff2/g)].map((x) => x[0]))];
    let i = 0;
    for (const fontUrl of fontUrls) {
      const buf = Buffer.from(await (await fetch(fontUrl, { headers: { 'User-Agent': CHROME_UA } })).arrayBuffer());
      const name = `f${i++}.woff2`;
      assets.set(`/_app/fonts/${name}`, buf);
      css = css.split(fontUrl).join(`./fonts/${name}`);
    }
    return css;
  } catch {
    return null; // offline / fetch failure → skip localization, keep rendering
  }
}

// Pure HTML transforms applied to the captured SSR document.
function transformShareHtml(html: string, opts: { hasLocalFonts: boolean }): string {
  let h = html;
  // 1. page→entry refs: ../_app → ./_app. The ./ prefix is MANDATORY — a bare
  //    "_app/…" specifier is illegal for dynamic import() (packaging-spike).
  h = h.replaceAll('../_app/', './_app/');
  // 2. drop root-absolute icon / apple-touch / manifest links (would 404 under
  //    /d/<slug>/ on the static host).
  h = h.replace(/[ \t]*<link\b[^>]*\brel="(?:icon|apple-touch-icon|manifest)"[^>]*>\n?/g, '');
  // 3. fonts: remove the Google preconnect/preload/stylesheet links; swap in the
  //    localized stylesheet so the artifact has zero external dependencies.
  h = h.replace(/[ \t]*<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\n?/g, '');
  if (opts.hasLocalFonts) {
    h = h.replace('</head>', '\t\t<link rel="stylesheet" href="./_app/fonts.css" />\n\t</head>');
  }
  // 4. neutralize the layout auth probe (MlAuthBadge polls /api/ml-auth — there
  //    is no backend on the static host). Patch fetch before hydration runs.
  const guard =
    `<script>(function(){var f=window.fetch;window.fetch=function(u){try{` +
    `var s=typeof u==="string"?u:(u&&u.url)||"";` +
    `if(s.indexOf("/api/ml-auth")!==-1)return Promise.resolve(new Response(null,{status:204}));` +
    `}catch(e){}return f.apply(this,arguments);};})();</script>`;
  h = h.replace('<head>', '<head>\n\t\t' + guard);
  return h;
}

export async function renderDigestHtml(roundId: number): Promise<HtmlShareResult> {
  const slug = getOrCreateShareSlug(roundId);
  const outDir = join(DIGESTS_DIR, 'd', slug);
  const origin = new URL(APP_INTERNAL_URL).origin;

  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 1000, deviceScaleFactor: 2 });

    // Capture the same-origin /_app/ asset closure the browser fetches during a
    // real hydrated load (entry + transitively-imported chunks/nodes + CSS).
    const assets = new Map<string, Buffer>();
    page.on('response', async (resp) => {
      try {
        if (resp.request().method() !== 'GET') return;
        const u = new URL(resp.url());
        if (u.origin !== origin || !u.pathname.startsWith('/_app/') || !resp.ok()) return;
        assets.set(u.pathname, await resp.buffer());
      } catch {
        /* ignore a single asset capture failure */
      }
    });

    // NO ?export=1 — interactivity stays ON (sprint-18 flag would disable it).
    const url = `${APP_INTERNAL_URL}/digest/${roundId}`;
    const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
    if (!resp || !resp.ok()) throw new Error(`html render load failed: ${resp?.status() ?? 'no-response'} ${url}`);
    await page.waitForSelector('.dg-export', { timeout: 15_000 });
    // Best-effort: ensure the interactive tastemaker chunk loaded (non-fatal if
    // a round has no tastemaker section).
    await page.waitForSelector('[data-component="tastemaker"]', { timeout: 8_000 }).catch(() => {});

    const rawHtml = await resp.text();
    const fontCss = await localizeFonts(rawHtml, assets);
    await browser.close();

    // Overwrite in place (stable slug → shared links never break).
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    let bytes = 0;
    let files = 0;
    for (const [pathname, buf] of assets) {
      const dest = join(outDir, pathname.replace(/^\//, ''));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      bytes += buf.length;
      files += 1;
    }
    if (fontCss) {
      await writeFile(join(outDir, '_app', 'fonts.css'), fontCss, 'utf8');
      bytes += Buffer.byteLength(fontCss);
      files += 1;
    }

    const indexHtml = transformShareHtml(rawHtml, { hasLocalFonts: !!fontCss });
    await writeFile(join(outDir, 'index.html'), indexHtml, 'utf8');
    bytes += Buffer.byteLength(indexHtml);
    files += 1;

    touchShare(roundId);
    return { slug, url: `${PUBLIC_DIGEST_BASE}/d/${slug}`, dir: outDir, bytes, files };
  } finally {
    await browser.close().catch(() => {});
  }
}

export function isExportFormat(v: unknown): v is DigestExportFormat {
  return v === 'mobile' || v === 'wide' || v === 'pdf' || v === 'png-sections';
}

export function contentTypeFor(filename: string): string {
  return extname(filename).toLowerCase() === '.pdf' ? 'application/pdf' : 'image/png';
}

export function exportPathFor(filename: string): string {
  // Defensive: reject path traversal; only allow basenames of our naming scheme.
  const safe = basename(filename);
  if (!/^r-\d+-digest-[\w-]+\.(png|pdf)$/.test(safe)) {
    throw new Error('invalid export filename');
  }
  return join(EXPORTS_DIR, safe);
}
