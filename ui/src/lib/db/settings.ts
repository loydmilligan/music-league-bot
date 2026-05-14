import type Database from 'better-sqlite3';
import type { Settings } from '../types.js';
import { DEFAULT_SETTINGS } from './schema.js';

export function getSettings(db: Database.Database): Settings {
  const m = Object.fromEntries(
    (db.prepare('SELECT key,value FROM settings').all() as any[]).map(r => [r.key, r.value])
  );
  return {
    weightDiscovery: +( m.weight_discovery ?? DEFAULT_SETTINGS.weight_discovery),
    weightThemeFit:  +( m.weight_theme_fit  ?? DEFAULT_SETTINGS.weight_theme_fit),
    weightPersonal:  +( m.weight_personal   ?? DEFAULT_SETTINGS.weight_personal),
    weightNostalgia: +( m.weight_nostalgia  ?? DEFAULT_SETTINGS.weight_nostalgia),
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
