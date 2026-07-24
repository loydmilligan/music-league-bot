import type Database from 'better-sqlite3';

// NOTE: this file deviates from the original task brief. The brief assumed
// `players.is_owner` and a bare-`SCHEMA` fixture; the real schema has neither
// (see voiceSample.test.ts header comment for the full writeup). Owner
// identity is instead resolved from the OWNER_PHONE_NUMBER env var matched
// against players.chat_identifier.

type Env = Record<string, string | undefined>;

/** Digits-only, US-normalized (drops a leading country-code '1' on 11-digit
 * numbers) so '+16617476822' and '16617476822' compare equal. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * The app owner's player id — the person whose ballot this lab is for.
 * Resolved via OWNER_PHONE_NUMBER (env) matched against players.chat_identifier,
 * since there is no is_owner flag in the real schema. Never throws.
 */
export function getOwnerPlayerId(db: Database.Database, env: Env = process.env): number | null {
  const ownerNumber = env.OWNER_PHONE_NUMBER;
  if (!ownerNumber) return null;
  const target = normalizePhone(ownerNumber);
  if (!target) return null;
  try {
    const rows = db.prepare(
      `SELECT id, chat_identifier FROM players
       WHERE chat_type = 'whatsapp' AND chat_identifier IS NOT NULL AND TRIM(chat_identifier) != ''`,
    ).all() as { id: number; chat_identifier: string }[];
    const match = rows.find((r) => normalizePhone(r.chat_identifier) === target);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/** Free-text taste profile used to personalize the per-song take. Always a
 * string (never null/undefined) so callers can embed it directly in a prompt. */
export function getOwnerTasteFingerprint(db: Database.Database, env: Env = process.env): string {
  const playerId = getOwnerPlayerId(db, env);
  if (playerId === null) return '';
  try {
    const row = db.prepare(
      `SELECT taste_fingerprint FROM player_profiles WHERE player_id = ?`,
    ).get(playerId) as { taste_fingerprint: string | null } | undefined;
    return row?.taste_fingerprint ?? '';
  } catch {
    return '';
  }
}

/**
 * The owner's own past vote comments, newest first, across ALL leagues
 * (explicit product decision — not scoped to one league) — used as few-shot
 * voice examples for comment drafting. Empty/whitespace-only comments are
 * skipped. Returns [] when there is no owner or no comments.
 */
export function getVoiceSample(db: Database.Database, limit = 8, env: Env = process.env): string[] {
  const playerId = getOwnerPlayerId(db, env);
  if (playerId === null) return [];
  try {
    const rows = db.prepare(
      `SELECT comment FROM votes
       WHERE player_id = ? AND comment IS NOT NULL AND TRIM(comment) != ''
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(playerId, limit) as { comment: string }[];
    return rows.map((r) => r.comment);
  } catch {
    return [];
  }
}
