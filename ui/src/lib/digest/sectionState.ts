import type Database from 'better-sqlite3';
import { modelForSection, SECTION_BUCKET_MAP, HARDCODED_MODEL } from './modelFor.js';

export type BucketReq = { json: true };

export interface SectionState {
  key: string;
  section: string;
  label: string;
  bucket: 'predict' | 'digest';
  selected: string | null;
  resolved: string;
  requires: BucketReq;
}

// Human-readable display labels for each section.
export const SECTION_LABELS: Record<string, string> = {
  // digest (6)
  podium:                          'Podium',
  villain:                         'Villain',
  flow:                            'Flow',
  consensus:                       'Consensus',
  quotes:                          'Quotes',
  chat:                            'Chat',
  // predict (10)
  'narrative-player-superlatives': 'Player Superlatives',
  'narrative-fan-hater-blurbs':    'Fan/Hater Blurbs',
  'narrative-league-reel':         'League Reel',
  'narrative-moment-lines':        'Moment Lines',
  'profile-spectrum':              'Taste Spectrum',
  'profile-playlist':              'Discovery Playlist',
  'season-update':                 'Season Update',
  'submission-predict':            'Submission Predict',
  'vote-probe':                    'Vote Probe',
  'taste-fingerprint':             'Taste Fingerprint',
};

export const KNOWN_SECTIONS = Object.keys(SECTION_BUCKET_MAP) as string[];

/**
 * Build the full SectionState for one section, reading the DB pin if any.
 */
export function buildSectionState(section: string, db: Database.Database): SectionState {
  const bucket: 'predict' | 'digest' = SECTION_BUCKET_MAP[section] ?? 'predict';
  const sectionKey = `digest_model_${section}`;
  const pinRow = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(sectionKey) as { value: string } | undefined;
  const selected = pinRow?.value ?? null;
  const resolved = modelForSection(section, db);

  return {
    key: sectionKey,
    section,
    label: SECTION_LABELS[section] ?? section,
    bucket,
    selected,
    resolved,
    requires: { json: true },
  };
}

/**
 * Build SectionState for all 16 known sections.
 * Returns a Record keyed by section string.
 */
export function buildAllSectionStates(db: Database.Database): Record<string, SectionState> {
  const result: Record<string, SectionState> = {};
  for (const section of KNOWN_SECTIONS) {
    result[section] = buildSectionState(section, db);
  }
  return result;
}

// Re-export HARDCODED_MODEL for convenience (used by route tests).
export { HARDCODED_MODEL };
