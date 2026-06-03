import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const APP_INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;
const EXPORTS_DIR = join(process.env.DATA_DIR || '/app/data', 'exports');

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
