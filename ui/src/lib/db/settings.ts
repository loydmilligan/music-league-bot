import type Database from 'better-sqlite3';
import type { Settings } from '../types.js';
import type { TasteSettings } from '../taste-waveform/taste-waveform.js';
import { DEFAULT_SETTINGS } from './schema.js';

const DEFAULT_TASTE_SETTINGS: TasteSettings = {
	signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
	showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
};

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
