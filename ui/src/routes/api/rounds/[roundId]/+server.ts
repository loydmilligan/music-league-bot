import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundById, patchRound, updateRound, type RoundPatch } from '$lib/db/rounds.js';
import { getRoundPhase } from '$lib/lifecycle.js';
import { ingestPlaylist } from '$lib/import/playlistIngest.js';

interface PatchBody {
  name?: string;
  theme?: string | null;       // → description column
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  playlist_url?: string | null; // → spotify_playlist_url column
  // round management fields
  tag?: string | null;
  theme_submitted_by?: number | null;
  round_number?: number | null;
}

const SPOTIFY_PLAYLIST_RE = /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+(?:\?.*)?$/;

function isIsoDateOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string' || v.trim() === '') return false;
  return !Number.isNaN(Date.parse(v));
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const existing = getRoundById(db, roundId);
  if (!existing) throw error(404, `round not found: ${roundId}`);

  const body = (await request.json().catch(() => ({}))) as Partial<PatchBody>;

  const patch: RoundPatch = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      throw error(400, 'name must be a non-empty string');
    }
    patch.name = body.name.trim();
  }

  if (body.theme !== undefined) {
    if (body.theme !== null && typeof body.theme !== 'string') {
      throw error(400, 'theme must be a string or null');
    }
    patch.description = body.theme;
  }

  if (body.submission_deadline !== undefined) {
    if (!isIsoDateOrNull(body.submission_deadline)) {
      throw error(400, 'submission_deadline must be an ISO date string or null');
    }
    patch.submissionDeadline = body.submission_deadline;
  }

  if (body.voting_deadline !== undefined) {
    if (!isIsoDateOrNull(body.voting_deadline)) {
      throw error(400, 'voting_deadline must be an ISO date string or null');
    }
    patch.votingDeadline = body.voting_deadline;
  }

  // Cross-field deadline ordering check: use the effective values that will
  // exist after the patch (patched value if provided, else current row).
  const effSub = patch.submissionDeadline !== undefined ? patch.submissionDeadline : existing.submissionDeadline;
  const effVote = patch.votingDeadline !== undefined ? patch.votingDeadline : existing.votingDeadline;
  if (effSub && effVote && Date.parse(effVote) <= Date.parse(effSub)) {
    throw error(400, 'voting_deadline must be after submission_deadline');
  }

  if (body.playlist_url !== undefined) {
    if (body.playlist_url !== null) {
      if (typeof body.playlist_url !== 'string' || !SPOTIFY_PLAYLIST_RE.test(body.playlist_url)) {
        throw error(400, 'playlist_url must match https://open.spotify.com/playlist/<id>');
      }
    }
    patch.spotifyPlaylistUrl = body.playlist_url;
  }

  // Round management fields (tag, theme_submitted_by, round_number).
  const mgmtPatch: Parameters<typeof updateRound>[2] = {};
  if (body.tag !== undefined) mgmtPatch.tag = body.tag;
  if (body.theme_submitted_by !== undefined) {
    if (body.theme_submitted_by !== null && typeof body.theme_submitted_by !== 'number') {
      throw error(400, 'theme_submitted_by must be a player id or null');
    }
    mgmtPatch.theme_submitted_by = body.theme_submitted_by;
  }
  if (body.round_number !== undefined) {
    if (body.round_number !== null && (typeof body.round_number !== 'number' || !Number.isInteger(body.round_number))) {
      throw error(400, 'round_number must be an integer or null');
    }
    mgmtPatch.round_number = body.round_number;
  }

  if (Object.keys(patch).length === 0 && Object.keys(mgmtPatch).length === 0) {
    // No-op patch: return the unchanged row.
    return json({ round: existing, phase: existing.phase });
  }

  if (Object.keys(mgmtPatch).length > 0) updateRound(db, roundId, mgmtPatch);
  patchRound(db, roundId, patch);
  const updated = getRoundById(db, roundId)!;
  const newPhase = getRoundPhase(updated);

  // Fire-and-forget playlist ingest when a new playlist URL is set during voting.
  const playlistChanged = patch.spotifyPlaylistUrl !== undefined
    && patch.spotifyPlaylistUrl !== existing.spotifyPlaylistUrl;
  if (playlistChanged && newPhase === 'voting' && updated.spotifyPlaylistUrl) {
    // Fire-and-forget: don't await before responding. Errors are swallowed
    // inside ingestPlaylist (logs a warning and no-ops); we still log here
    // so an unexpected rejection surfaces in the dev console.
    void ingestPlaylist(roundId, updated.spotifyPlaylistUrl).catch(e =>
      console.error('[round-edit-api] ingestPlaylist threw:', e),
    );
  }

  return json({ round: updated, phase: newPhase });
};
