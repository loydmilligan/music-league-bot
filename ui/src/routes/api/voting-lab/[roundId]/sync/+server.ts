import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '$lib/db/client.js';
import { syncRoundSongs } from '$lib/voting-lab/liveSync.js';
import type { CliSong } from '$lib/voting-lab/liveSync.js';

const run = promisify(execFile);

/**
 * Path to the musicleague CLI; override with MUSICLEAGUE_CLI when it moves.
 *
 * VERIFIED locally: `cli-web-musicleague votes list <leagueId> <roundId> --json`
 * is the real subcommand — confirmed by running it against a live
 * voting-phase round (Boarz II Men, "I Heard It Through the Napster").
 * Sample row shape:
 *   { league_id, round_id, track_id, track_url, track_name, artist, album,
 *     submitter_id, total_votes }
 * `submitter_id` came back `null` for every song in that live voting-phase
 * round — Music League itself withholds it until voting closes — but we
 * never read that field into CliSong regardless, per the anonymity rule.
 *
 * NOT VERIFIED / KNOWN GAP: this repo's `rounds` table has no ml_league_id
 * column (see leagues onboarding notes — one league row spans many ML
 * league GUIDs, one per season, resolved only by fuzzy name-match). This
 * endpoint resolves it the same way ml-auth-trigger.mjs's resolveLeagueId
 * does: `leagues list --json`, then match by league name.
 *
 * PRODUCTION CONCERN (important, could not verify end-to-end): the bot-ui
 * service runs inside the `bot-ui` Docker container (see docker-compose.yml),
 * which does not have `cli-web-musicleague` on PATH or the host's saved
 * Music League auth session. Every other CLI-shelling feature in this repo
 * (leagues export, rounds themes) bridges through the host-side
 * `ml-auth-trigger` daemon at `http://host.docker.internal:7679`
 * (scripts/ml-auth-trigger.mjs) rather than exec'ing the CLI directly from
 * the SvelteKit server. This endpoint execs the CLI directly, matching the
 * task brief's spec and staying in this task's declared scope (liveSync +
 * endpoint + button only) — but in the deployed container it will fail with
 * ENOENT/502, not because the command below is wrong, but because the CLI
 * binary and auth session simply aren't present in that container. A human
 * should either (a) add a `/round-songs` (or similar) endpoint to
 * ml-auth-trigger.mjs mirroring `/rounds-snapshot`, and point this file at
 * it, or (b) confirm bot-ui is meant to run with host CLI access in some
 * environments. This was not something I could resolve within this task's
 * scope, so flagging it explicitly rather than guessing.
 */
const CLI = process.env.MUSICLEAGUE_CLI ?? 'cli-web-musicleague';
const CLI_TIMEOUT_MS = 30_000;

type CliLeague = { id?: string; league_id?: string; leagueId?: string; name?: string };

type CliRow = {
  // Verified real field names from `votes list --json`.
  track_id?: string;
  track_url?: string;
  track_name?: string;
  artist?: string;
  album?: string;
  // Tolerate the brief's originally-guessed spellings too, in case a future
  // CLI version renames fields.
  spotify_uri?: string;
  uri?: string;
  title?: string;
  artists?: string;
  album_art_url?: string | null;
};

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function resolveMlLeagueId(leagueName: string): Promise<string> {
  const { stdout } = await run(CLI, ['--json', 'leagues', 'list'], { timeout: CLI_TIMEOUT_MS });
  const parsed = JSON.parse(stdout) as CliLeague[] | { leagues?: CliLeague[]; data?: CliLeague[] };
  const leagues: CliLeague[] = Array.isArray(parsed)
    ? parsed
    : (parsed.leagues ?? parsed.data ?? []);

  const needle = normalizeName(leagueName);
  const exact = leagues.find((l) => normalizeName(l.name ?? '') === needle);
  let target = exact;
  if (!target) {
    const fuzzy = leagues.filter((l) => {
      const n = normalizeName(l.name ?? '');
      return n.includes(needle) || needle.includes(n);
    });
    if (fuzzy.length === 1) target = fuzzy[0];
    else if (fuzzy.length > 1) {
      throw new Error(
        `ambiguous league name "${leagueName}" — matches ${fuzzy.length}: ${fuzzy.map((l) => l.name).join(', ')}`,
      );
    }
  }
  if (!target) {
    throw new Error(`league "${leagueName}" not found in leagues list (got ${leagues.length})`);
  }
  const mlLeagueId = target.id ?? target.league_id ?? target.leagueId;
  if (!mlLeagueId) throw new Error('matched league has no usable id field');
  return mlLeagueId;
}

function toCliSongs(rows: CliRow[]): CliSong[] {
  return rows
    .map((r) => {
      const uri = r.spotify_uri ?? r.uri ?? (r.track_id ? `spotify:track:${r.track_id}` : '');
      return {
        spotifyUri: uri,
        title: r.track_name ?? r.title ?? '',
        artist: r.artist ?? r.artists ?? '',
        albumArtUrl: r.album_art_url ?? null,
      };
    })
    .filter((s) => s.spotifyUri && s.title);
}

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const round = db
    .prepare(
      `SELECT r.ml_round_id AS ml_round_id, l.name AS league_name
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { ml_round_id: string; league_name: string } | undefined;
  if (!round) throw error(404, 'round not found');

  let rows: CliRow[];
  try {
    const mlLeagueId = await resolveMlLeagueId(round.league_name);
    const { stdout } = await run(
      CLI,
      ['votes', 'list', mlLeagueId, round.ml_round_id, '--json'],
      { timeout: CLI_TIMEOUT_MS },
    );
    rows = JSON.parse(stdout) as CliRow[];
  } catch (e) {
    throw error(502, `musicleague CLI failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return json(syncRoundSongs(db, roundId, toCliSongs(rows)));
};
