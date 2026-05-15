#!/usr/bin/env node
// One-off: import upcoming-round metadata from data/<league>/season-<n>/round-data-from-website.csv
// Schema (rounds): id, season_id, ml_round_id UNIQUE, name, description,
//   spotify_playlist_url, submission_deadline, voting_deadline, created_at
// CSVs only carry name/description/deadlines + theme creator + status.
// Theme creator + status have no column → dropped. Existing rounds (matched
// by case-insensitive name within season) are left untouched.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, '..', 'data', 'league.db');
const now = new Date().toISOString();

const sources = [
  { league: 'fam-jam', season: 3, hasMode: false },
  { league: 'hip-jammers', season: 3, hasMode: true },
  { league: 'second-best', season: 1, hasMode: false }
];

const STATUSES = ['Completed', 'Complete', 'Current', 'Upcoming', 'Accepting Songs', 'Editable'];

// CSV cell parser — handles "..." quoting (incl "" escapes).
function parseCells(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

// Split a single concatenated CSV blob (header + all rows on one line) into
// logical lines by inserting a newline before every `,<digit>,<Status>,` boundary.
// Well-formed multi-line CSVs pass through unchanged.
function normalizeBlob(text) {
  if (text.includes('\n') && text.trim().split('\n').length > 1) return text;
  const statusAlt = STATUSES.map((s) => s.replace(/ /g, '\\s')).join('|');
  // Match the boundary that starts a new row: comma + digits + comma + status + comma
  const re = new RegExp(`(?<=,(?:N/A|TBD|[^,]*))(\\d+),(${statusAlt}),`, 'g');
  // Simpler approach: find every "<n>,<Status>," occurrence and split there.
  const matches = [];
  const rowRe = new RegExp(`(\\d+),(${statusAlt}),`, 'g');
  let m;
  while ((m = rowRe.exec(text)) !== null) matches.push(m.index);
  if (matches.length < 2) return text;
  const parts = [];
  parts.push(text.slice(0, matches[0]));
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1] : text.length;
    parts.push(text.slice(matches[i], end));
  }
  return parts.join('\n');
}

function parseCsv(path, hasMode) {
  const raw = readFileSync(path, 'utf8').replace(/\r/g, '');
  const normalized = normalizeBlob(raw);
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  // Drop header line(s); a header starts with "Round Number"
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('Round Number')) continue;
    const cells = parseCells(line);
    if (cells.length < 6) continue;
    const [num, status, title, description, themeBy, ...rest] = cells;
    let songsDue, votesDue;
    if (hasMode) {
      // Round#, Status, Title, Desc, ThemeBy, Mode, SongsDue, VotesDue
      songsDue = rest[1];
      votesDue = rest[2];
    } else {
      // Round#, Status, Title, Desc, ThemeBy, SongsDue, VotesDue
      songsDue = rest[0];
      votesDue = rest[1];
    }
    rows.push({
      number: Number(num),
      status,
      title: title.trim(),
      description: description.trim(),
      themeBy: themeBy.trim(),
      songsDue: (songsDue ?? '').trim(),
      votesDue: (votesDue ?? '').trim()
    });
  }
  return rows;
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const getSeason = db.prepare(
  `SELECT s.id FROM seasons s JOIN leagues l ON l.id = s.league_id
   WHERE l.slug = ? AND s.season_number = ?`
);
const findRoundByName = db.prepare(
  `SELECT id, ml_round_id, name FROM rounds
   WHERE season_id = ? AND lower(name) = lower(?)`
);
const findRoundByMlId = db.prepare(`SELECT id FROM rounds WHERE ml_round_id = ?`);
const insertRound = db.prepare(
  `INSERT INTO rounds (season_id, ml_round_id, name, description, submission_deadline, voting_deadline, created_at)
   VALUES (@season_id, @ml_round_id, @name, @description, @sub, @vote, @created)`
);

let inserted = 0;
let skipped = 0;

for (const src of sources) {
  const csvPath = resolve(__dirname, '..', 'data', src.league, `season-${src.season}`, 'round-data-from-website.csv');
  const season = getSeason.get(src.league, src.season);
  if (!season) {
    console.warn(`! ${src.league} season ${src.season}: season row not found, skipping`);
    continue;
  }
  const rows = parseCsv(csvPath, src.hasMode);
  console.log(`\n== ${src.league} season ${src.season} (${rows.length} CSV rows) ==`);
  for (const r of rows) {
    if (!r.title || r.title.toLowerCase() === 'tbd') {
      console.log(`  - r${r.number}: skipped (placeholder title "${r.title}")`);
      skipped++;
      continue;
    }
    const existing = findRoundByName.get(season.id, r.title);
    if (existing) {
      console.log(`  - r${r.number} "${r.title}": exists (id=${existing.id}), skipping`);
      skipped++;
      continue;
    }
    const mlId = `csv-${src.league}-s${src.season}-r${r.number}`;
    if (findRoundByMlId.get(mlId)) {
      console.log(`  - r${r.number} "${r.title}": already imported via CSV (${mlId})`);
      skipped++;
      continue;
    }
    insertRound.run({
      season_id: season.id,
      ml_round_id: mlId,
      name: r.title,
      description: r.description || null,
      sub: r.songsDue && r.songsDue !== 'N/A' && r.songsDue !== 'TBD' ? r.songsDue : null,
      vote: r.votesDue && r.votesDue !== 'N/A' && r.votesDue !== 'TBD' ? r.votesDue : null,
      created: now
    });
    inserted++;
    console.log(`  + r${r.number} "${r.title}" (theme by ${r.themeBy || 'n/a'}) → ${mlId}`);
  }
}

console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
db.close();
