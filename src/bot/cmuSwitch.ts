import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The owner's global catch-me-up kill switch (`@bot off` / `@bot on`).
 * Persisted as `{ "enabled": boolean, "at": ISO }` so it survives a restart.
 * A missing or unreadable file means enabled.
 */
export interface CmuSwitch {
  isEnabled(): boolean;
  /** Throws when the file can't be written; the in-memory state is then unchanged. */
  set(enabled: boolean, now: Date): void;
}

export function cmuSwitchPath(): string {
  return path.resolve(process.env.DATA_DIR ?? 'data', 'cmu-switch.json');
}

function read(file: string): boolean {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (d && typeof d === 'object' && typeof (d as Record<string, unknown>).enabled === 'boolean') {
      return (d as { enabled: boolean }).enabled;
    }
  } catch {
    // missing or corrupt
  }
  return true;
}

export function openCmuSwitch(file: string = cmuSwitchPath()): CmuSwitch {
  let enabled = read(file);
  return {
    isEnabled: () => enabled,
    set(next, now) {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ enabled: next, at: now.toISOString() }) + '\n');
      renameSync(tmp, file);
      enabled = next;
    },
  };
}

/** An in-memory switch: the default when none is wired (tests, or CMU unconfigured). */
export function memoryCmuSwitch(enabled = true): CmuSwitch {
  return { isEnabled: () => enabled, set: (next) => { enabled = next; } };
}
