/**
 * Portal login codes (spec: docs/superpowers/specs/2026-10-15-portal-otp-login-design.md §1).
 *
 * The survey app mints a 6-digit code and asks the bot to DM it to the player's
 * number on file in league.db. The number never leaves this module's caller.
 *
 * - Bypasses the survey opt-in guard (the player asked for the code) but keeps
 *   its own limit: 3 codes / player / rolling hour, in memory.
 * - LOGIN_CODE_REDIRECT=+E164 sends EVERY code to that number instead, prefixed
 *   with the player name. An invalid redirect fails closed (never falls back to
 *   the real number).
 * - Group ids are refused by resolveDmTarget.
 */
import type Database from 'better-sqlite3';
import { normalizeE164, resolveDmTarget } from './dmGuard.js';

export type LoginCodeReason = 'unknown_player' | 'no_number' | 'rate_limited' | 'send_failed';
export type LoginCodeResult = { sent: true } | { sent: false; reason: LoginCodeReason };
export interface LoginCodeRequest { league: string; name: string; code: string }

/** Lookup result: null = no such player; e164 null = player has no usable number. */
export type LoginCodeLookup = (name: string) => { player: string; e164: string | null } | null;

/** Survey/portal display name (normalized) → players.name. */
export const LOGIN_NAME_ALIASES: Record<string, string> = {
  'jimmy troy': 'Jimmy',
};

export const LOGIN_CODE_LIMIT = 3;
export const LOGIN_CODE_WINDOW_MS = 60 * 60 * 1000;

export function normalizeName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Only identifiers that look like phone numbers count; gchat/notify names are ignored. */
export function pickWhatsAppNumber(identifiers: string[]): string | null {
  // Newest row wins when a player has more than one number.
  for (const raw of [...identifiers].reverse()) {
    if (!/^\+?[\d\s().-]+$/.test(raw.trim())) continue;
    const e164 = normalizeE164(raw);
    if (e164) return e164;
  }
  return null;
}

export function lookupPlayerNumber(db: Database.Database, name: string): { player: string; e164: string | null } | null {
  const players = db.prepare('SELECT id, name FROM players').all() as { id: number; name: string }[];
  const wanted = normalizeName(name);
  const target = normalizeName(LOGIN_NAME_ALIASES[wanted] ?? name);
  const player = players.find((p) => normalizeName(p.name) === wanted)
    ?? players.find((p) => normalizeName(p.name) === target);
  if (!player) return null;
  const rows = db
    .prepare("SELECT identifier FROM player_identities WHERE player_id = ? AND identity_type = 'whatsapp' ORDER BY id")
    .all(player.id) as { identifier: string }[];
  return { player: player.name, e164: pickWhatsAppNumber(rows.map((r) => r.identifier)) };
}

export function loginCodeText(code: string): string {
  return `Your Music League portal code is ${code}. It expires in 10 minutes.`;
}

export function createLoginCodeService(opts: {
  lookup: LoginCodeLookup;
  send: (target: string, text: string) => Promise<void>;
  redirect: string | undefined;
  now?: () => number;
  log?: (line: string) => void;
}) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const sends = new Map<string, number[]>();

  return {
    async request(req: LoginCodeRequest): Promise<LoginCodeResult> {
      const found = opts.lookup(req.name);
      if (!found) return { sent: false, reason: 'unknown_player' };
      if (!found.e164) return { sent: false, reason: 'no_number' };

      const key = normalizeName(found.player);
      const t = now();
      const recent = (sends.get(key) ?? []).filter((ts) => t - ts < LOGIN_CODE_WINDOW_MS);
      sends.set(key, recent);
      if (recent.length >= LOGIN_CODE_LIMIT) return { sent: false, reason: 'rate_limited' };

      const redirecting = opts.redirect !== undefined && opts.redirect.trim() !== '';
      const decision = resolveDmTarget(redirecting ? opts.redirect : found.e164);
      if (decision.action !== 'send') {
        log(`[login-code] blocked for ${found.player} — ${decision.reason}`);
        return { sent: false, reason: 'send_failed' };
      }
      const text = redirecting
        ? `[TEST → ${found.player}] ${loginCodeText(req.code)}`
        : loginCodeText(req.code);
      try {
        await opts.send(decision.target, text);
      } catch (err) {
        log(`[login-code] send failed for ${found.player}: ${err instanceof Error ? err.message : String(err)}`);
        return { sent: false, reason: 'send_failed' };
      }
      recent.push(t);
      log(`[login-code] sent code for ${found.player} (${req.league})${redirecting ? ' via redirect' : ''}`);
      return { sent: true };
    },
  };
}
