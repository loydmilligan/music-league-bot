import type Database from 'better-sqlite3';
import type { Settings } from '../types.js';
import { DEFAULT_TASTE_SETTINGS, type TasteSettings } from '../taste-waveform/taste-waveform.js';
import { DEFAULT_SETTINGS } from './schema.js';

/** Obscurity thresholds separating the 4 Tastemaker buckets: radioHit < b1 <= recognizable < b2 <= curiousCut < b3 <= rabbitHole. */
export interface BucketBoundaries { b1: number; b2: number; b3: number }
export const DEFAULT_BUCKET_BOUNDARIES: BucketBoundaries = { b1: 10, b2: 20, b3: 30 };

const BUCKET_BOUNDARIES_KEY = 'tastemaker_bucket_boundaries';

function isValidBucketBoundaries(v: unknown): v is BucketBoundaries {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  if (typeof b.b1 !== 'number' || typeof b.b2 !== 'number' || typeof b.b3 !== 'number') return false;
  if (!Number.isInteger(b.b1) || !Number.isInteger(b.b2) || !Number.isInteger(b.b3)) return false;
  return b.b1 >= 1 && b.b1 < b.b2 && b.b2 < b.b3 && b.b3 <= 100;
}

/** The Tastemaker archetype-bucket obscurity thresholds. Falls back to the shipped defaults if unset/malformed. */
export function getBucketBoundaries(db: Database.Database): BucketBoundaries {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(BUCKET_BOUNDARIES_KEY) as { value: string } | undefined;
  if (!row?.value) return { ...DEFAULT_BUCKET_BOUNDARIES };
  try {
    const parsed = JSON.parse(row.value);
    return isValidBucketBoundaries(parsed) ? parsed : { ...DEFAULT_BUCKET_BOUNDARIES };
  } catch {
    return { ...DEFAULT_BUCKET_BOUNDARIES };
  }
}

/** Persists new bucket boundaries. Throws if b1 < b2 < b3 doesn't hold (strictly increasing, 1-100). */
export function updateBucketBoundaries(db: Database.Database, boundaries: BucketBoundaries): BucketBoundaries {
  if (!isValidBucketBoundaries(boundaries)) {
    throw new Error('bucket boundaries must be integers with 1 <= b1 < b2 < b3 <= 100');
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    BUCKET_BOUNDARIES_KEY,
    JSON.stringify(boundaries),
  );
  return boundaries;
}

export function getTasteSettings(db: Database.Database): TasteSettings {
	const row = db.prepare("SELECT value FROM settings WHERE key='taste_settings'").get() as { value: string } | undefined;
	try { return { ...DEFAULT_TASTE_SETTINGS, ...(row ? JSON.parse(row.value) : {}) }; } catch { return { ...DEFAULT_TASTE_SETTINGS }; }
}

export function getSettings(db: Database.Database): Settings {
  const m = Object.fromEntries(
    (db.prepare('SELECT key,value FROM settings').all() as any[]).map(r => [r.key, r.value])
  );
  return {
    weightDiscovery:       +( m.weight_discovery       ?? DEFAULT_SETTINGS.weight_discovery),
    weightThemeFit:        +( m.weight_theme_fit        ?? DEFAULT_SETTINGS.weight_theme_fit),
    weightPersonal:        +( m.weight_personal         ?? DEFAULT_SETTINGS.weight_personal),
    weightNostalgia:       +( m.weight_nostalgia        ?? DEFAULT_SETTINGS.weight_nostalgia),
    weightQuality:         +( m.weight_quality          ?? DEFAULT_SETTINGS.weight_quality),
    weightReplayability:   +( m.weight_replayability    ?? DEFAULT_SETTINGS.weight_replayability),
    legacyWeightsDeprecatedAt: m.legacy_weights_deprecated_at ?? null,
  };
}

export function updateWeights(db: Database.Database, w: Partial<Settings>): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  const tx = db.transaction((weights: Partial<Settings>) => {
    if (weights.weightDiscovery != null) stmt.run('weight_discovery', String(weights.weightDiscovery));
    if (weights.weightThemeFit  != null) stmt.run('weight_theme_fit',  String(weights.weightThemeFit));
    if (weights.weightPersonal  != null) stmt.run('weight_personal',   String(weights.weightPersonal));
    if (weights.weightNostalgia != null) stmt.run('weight_nostalgia',  String(weights.weightNostalgia));
  });
  tx(w);
}

export function updateUnicardWeights(db: Database.Database, w: { weightDiscovery: number; weightThemeFit: number; weightQuality: number; weightReplayability: number }): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  db.transaction(() => {
    stmt.run('weight_discovery',     String(w.weightDiscovery));
    stmt.run('weight_theme_fit',     String(w.weightThemeFit));
    stmt.run('weight_quality',       String(w.weightQuality));
    stmt.run('weight_replayability', String(w.weightReplayability));
  })();
}

export function setLegacyWeightsDeprecatedAt(db: Database.Database, ts: string | null): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  if (ts == null) {
    db.prepare("DELETE FROM settings WHERE key='legacy_weights_deprecated_at'").run();
  } else {
    stmt.run('legacy_weights_deprecated_at', ts);
  }
}
