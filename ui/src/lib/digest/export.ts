import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const APP_INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;
const EXPORTS_DIR = join(process.env.DATA_DIR || '/app/data', 'exports');
const VIEWPORT_WIDTH = 800;

export interface ExportResult {
  filename: string;
  absPath: string;
  bytes: number;
}

export async function renderDigestPng(roundId: number): Promise<ExportResult> {
  await mkdir(EXPORTS_DIR, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const filename = `r-${roundId}-digest-${ts}.png`;
  const absPath = join(EXPORTS_DIR, filename);

  const browser = await puppeteer.launch({
    executablePath: EXEC_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: 1200, deviceScaleFactor: 2 });
    const url = `${APP_INTERNAL_URL}/digest/${roundId}?export=1`;
    const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`page load failed: ${resp?.status() ?? 'no-response'} ${url}`);
    }
    await page.waitForSelector('.dg-export', { timeout: 10_000 });
    // Belt-and-suspenders: hide anything that could leak into the bbox even if T9 wiring drifts.
    await page.addStyleTag({
      content: `
        .dg-pipe, .dg-pipeline, .dg-pipe-strip,
        .dg-section-actions, .dg-section-banner,
        .dg-whole-regen, [data-export-hide="1"] { display: none !important; }
      `,
    });
    const handle = await page.$('.dg-export');
    if (!handle) throw new Error('.dg-export not found in rendered page');
    const png = (await handle.screenshot({ type: 'png', omitBackground: false })) as Buffer;
    await writeFile(absPath, png);
    return { filename, absPath, bytes: png.length };
  } finally {
    await browser.close().catch(() => {});
  }
}

export function exportPathFor(filename: string): string {
  // Defensive: reject path traversal; only allow basename of our own naming scheme.
  const safe = basename(filename);
  if (!/^r-\d+-digest-\d+\.png$/.test(safe)) {
    throw new Error('invalid export filename');
  }
  return join(EXPORTS_DIR, safe);
}
