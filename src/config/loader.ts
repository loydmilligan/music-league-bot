import { readFileSync } from 'node:fs';
import { rulesConfigSchema, type RulesConfig } from './types.js';

export function parseConfig(raw: unknown): RulesConfig {
  return rulesConfigSchema.parse(raw);
}

export function loadConfig(configPath: string): RulesConfig {
  const text = readFileSync(configPath, 'utf-8');
  return parseConfig(JSON.parse(text));
}
