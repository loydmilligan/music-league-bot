/**
 * WhatsApp player DMs only go to numbers that turned the toggle on in Settings.
 * Linked-but-off is not enough. Group /say is unchanged.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeE164, resolveDmTarget, type DmDecision } from './dmGuard.js';

export const OPT_IN_FILES = ['player-settings.json', 'second-best-player-settings.json'] as const;
export const OFF_REASON = 'WhatsApp notifications are off';

type SettingsFile = Record<string, {
  whatsapp?: { enabled?: boolean; e164?: string | null };
}>;

export function collectOptedIn(files: SettingsFile[]): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    for (const row of Object.values(file ?? {})) {
      if (row?.whatsapp?.enabled !== true) continue;
      const e164 = normalizeE164(row.whatsapp.e164);
      if (e164) out.add(e164);
    }
  }
  return out;
}

export function allowPlayerDm(raw: string | null | undefined, optedIn: Set<string>): DmDecision {
  const decision = resolveDmTarget(raw);
  if (decision.action !== 'send') return decision;
  if (!optedIn.has(decision.e164)) {
    return { action: 'block', reason: OFF_REASON };
  }
  return decision;
}

export async function loadOptedInWhatsApp(dir: string, names: readonly string[] = OPT_IN_FILES): Promise<Set<string>> {
  const files: SettingsFile[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) files.push(raw as SettingsFile);
    } catch {
      /* missing file = nobody opted in from that league */
    }
  }
  return collectOptedIn(files);
}
