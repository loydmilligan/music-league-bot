import { readFileSync } from 'node:fs';
import { rulesConfigSchema, type RulesConfig } from './types.js';

export function parseConfig(raw: unknown): RulesConfig {
  return rulesConfigSchema.parse(raw);
}

export function loadConfig(configPath: string): RulesConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse config at ${configPath}: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
