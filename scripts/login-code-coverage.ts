/**
 * Which portal names can receive a WhatsApp login code? Read-only against
 * league.db; uses the same lookup as POST /login-code. Numbers are masked.
 *
 *   npx tsx scripts/login-code-coverage.ts                 # Boarz roster
 *   npx tsx scripts/login-code-coverage.ts "Shane Farkas" "Jimmy Troy"
 *   LEAGUE_DB=/path/to/copy.db npx tsx scripts/login-code-coverage.ts
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { lookupPlayerNumber } from '../src/whatsapp/loginCode.js';

const BOARZ = [
  'Matt Mariani', 'Dave Steingart', 'Clements Johnson', 'Conor Johnston', 'Shane Farkas', 'Dave Jensen',
  'Jon Black', 'Grant Koziol', 'Darren Paletz', 'Jimmy Troy', 'Brian Grushkin', 'Ronnie Bertolina',
];

const names = process.argv.slice(2).length ? process.argv.slice(2) : BOARZ;
const dbPath = process.env.LEAGUE_DB ?? resolve(process.env.DATA_DIR ?? 'data', 'league.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

let ok = 0;
for (const name of names) {
  const hit = lookupPlayerNumber(db, name);
  const status = !hit ? 'no  (unknown player)' : hit.e164 ? `yes (…${hit.e164.slice(-2)})` : 'no  (no number)';
  if (hit?.e164) ok++;
  console.log(`${name.padEnd(20)} → ${status}`);
}
console.log(`\n${ok}/${names.length} resolved`);
db.close();
