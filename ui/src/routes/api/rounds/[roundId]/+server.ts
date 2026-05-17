import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundById, patchRound, type RoundPatch } from '$lib/db/rounds.js';
import { getRoundPhase } from '$lib/lifecycle.js';

interface PatchBody {
  name?: string;
  theme?: string | null;       // → description column
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  playlist_url?: string | null; // → spotify_playlist_url column
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

  if (Object.keys(patch).length === 0) {
    // No-op patch: return the unchanged row.
    return json({ round: existing, phase: existing.phase });
  }

  patchRound(db, roundId, patch);
  const updated = getRoundById(db, roundId)!;
  const newPhase = getRoundPhase(updated);

  // Fire-and-forget playlist ingest when a new playlist URL is set during voting.
  const playlistChanged = patch.spotifyPlaylistUrl !== undefined
    && patch.spotifyPlaylistUrl !== existing.spotifyPlaylistUrl;
  if (playlistChanged && newPhase === 'voting' && updated.spotifyPlaylistUrl) {
    // TODO(playlist-ingest task): replace with the real ingestPlaylist import.
    // Kept as a stub so this endpoint ships standalone; once playlist-ingest
    // lands the stub is a one-line swap.
    console.log('[round-edit-api] would ingest playlist', updated.spotifyPlaylistUrl, 'for round', roundId);
  }

  return json({ round: updated, phase: newPhase });
};
