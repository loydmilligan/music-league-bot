import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { parseMessage } from './parser/parseMessage.js';
import { applyRules } from './rules/engine.js';
import { getISOWeekNumber } from './rules/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/rules.json');

const config = loadConfig(configPath);
const weekNumber = getISOWeekNumber(new Date());
const year = new Date().getFullYear();

const examples = [
  '!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
  '!song Sade - No Ordinary Love',
  '!song The Beths - Expert in a Dying Field #summer',
  'hello world (ignored)',
];

for (const text of examples) {
  const parsed = parseMessage(text);
  if (!parsed) {
    console.log(`[ignored]  ${text}`);
    continue;
  }
  const matches = applyRules(config, parsed, { weekNumber, year });
  console.log(`[parsed]   ${parsed.rawText}`);
  console.log(`           command=${parsed.command} tags=[${parsed.tags.join(', ')}]`);
  for (const match of matches) {
    const spotify = match.spotify ?? '-';
    const youtube = match.youtube ?? '-';
    console.log(`           → "${match.name}": spotify="${spotify}" youtube="${youtube}"`);
  }
}
