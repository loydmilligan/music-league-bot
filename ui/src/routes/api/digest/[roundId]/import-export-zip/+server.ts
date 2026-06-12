import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { parseZip } from '$lib/import/zipParser.js';
import { importLiveRoundsData, importZipData } from '$lib/import/importer.js';
import { logImport } from '$lib/db/importLog.js';
import { probeMlAuth } from '$lib/mlAuth.js';
import { runPrepChecks } from '$lib/digest/prepChecks.js';

const TRIGGER_URL = process.env.ML_AUTH_TRIGGER_URL ?? 'http://localhost:7679';
const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
const REQUEST_TIMEOUT_MS = Number(process.env.ML_EXPORT_HTTP_TIMEOUT_MS ?? 120_000);

type Stage = 'auth' | 'cli' | 'download' | 'import' | 'other';

interface FailureBody {
  ok: false;
  stage: Stage;
  reason: string;
}

interface SuccessBody {
  ok: true;
  imported: { submissions: number; votes: number; voteComments: number };
  checks: ReturnType<typeof runPrepChecks>;
  durationMs: number;
  mlLeagueId?: string;
  liveRoundsImported?: number;
}

interface RoundContext {
  roundId: number;
  leagueName: string;
  slug: string;
  seasonNumber: number;
}

function fail(stage: Stage, reason: string, status = 200) {
  const body: FailureBody = { ok: false, stage, reason };
  return json(body, { status });
}

function lookupRoundContext(roundId: number): RoundContext | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT r.id AS round_id, l.name AS league_name, l.slug AS slug,
              s.season_number AS season_number
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as
    | { round_id: number; league_name: string; slug: string; season_number: number }
    | undefined;
  if (!row) return null;
  return {
    roundId: row.round_id,
    leagueName: row.league_name,
    slug: row.slug,
    seasonNumber: row.season_number,
  };
}

function countRoundData(roundId: number) {
  const db = getDb();
  const subs = (db.prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id=?').get(roundId) as { n: number }).n;
  const votes = (db.prepare('SELECT COUNT(*) n FROM votes WHERE round_id=?').get(roundId) as { n: number }).n;
  const comments = (db
    .prepare(
      `SELECT COUNT(*) n FROM votes
       WHERE round_id=? AND comment IS NOT NULL AND TRIM(comment) <> ''`,
    )
    .get(roundId) as { n: number }).n;
  return { subs, votes, comments };
}

// POST /api/digest/:roundId/import-export-zip
// Triggers `cli-web-musicleague leagues export` host-side via the ml-auth-trigger
// daemon, then imports the resulting export.zip through the existing manual-upload
// pipeline (parseZip → importZipData). Returns updated prep checks so the
// frontend can refresh in one round-trip.
export const POST: RequestHandler = async ({ params }) => {
  const startedAt = Date.now();
  const roundId = Number(params.roundId);
  if (!roundId || !Number.isFinite(roundId)) {
    return fail('other', 'invalid roundId', 400);
  }

  const ctx = lookupRoundContext(roundId);
  if (!ctx) return fail('other', `round not found: ${roundId}`, 404);

  // 1. Auth gate — bail early if the heartbeat says we're not logged in.
  const auth = await probeMlAuth();
  if (auth.status !== 'ok') {
    return fail('auth', auth.message ?? 'ml-auth required');
  }

  // 2. Bridge to the host daemon. AbortController guards the long CLI run.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let bridgeBody: unknown;
  let bridgeStatus = 0;
  try {
    const res = await fetch(`${TRIGGER_URL}/export-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueName: ctx.leagueName,
        slug: ctx.slug,
        seasonNumber: ctx.seasonNumber,
      }),
      signal: ac.signal,
    });
    bridgeStatus = res.status;
    bridgeBody = await res.json().catch(() => ({}));
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `host CLI exceeded ${REQUEST_TIMEOUT_MS}ms`
          : `host trigger unreachable at ${TRIGGER_URL}: ${err.message}`
        : 'host trigger unreachable';
    return fail('cli', reason);
  }
  clearTimeout(timer);

  const bridge = (bridgeBody ?? {}) as {
    ok?: boolean;
    stage?: Stage;
    reason?: string;
    path?: string;
    mlLeagueId?: string;
  };
  if (!bridge.ok) {
    const stage: Stage = bridge.stage ?? (bridgeStatus === 502 ? 'cli' : 'other');
    return fail(stage, bridge.reason ?? `host daemon returned ${bridgeStatus}`);
  }

  // 3. Best-effort live-round reconciliation via the CLI snapshot. This can
  //    repair stale complete seasons before the ZIP import lands.
  let liveRoundsImported = 0;
  try {
    const snapshotRes = await fetch(`${TRIGGER_URL}/rounds-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueName: ctx.leagueName,
        slug: ctx.slug,
        seasonNumber: ctx.seasonNumber,
      }),
      signal: ac.signal,
    });
    if (snapshotRes.ok) {
      const snapshotBody = (await snapshotRes.json().catch(() => ({}))) as {
        ok?: boolean;
        rounds?: Array<{
          id?: string;
          number?: number;
          name?: string;
          description?: string | null;
          playlistUrl?: string | null;
          submissionsDueUtc?: string | null;
          votesDueUtc?: string | null;
        }>;
      };
      if (snapshotBody.ok !== false && Array.isArray(snapshotBody.rounds) && snapshotBody.rounds.length > 0) {
        const liveRounds = snapshotBody.rounds
          .filter((r): r is {
            id: string;
            number: number;
            name: string;
            description?: string | null;
            playlistUrl?: string | null;
            submissionsDueUtc?: string | null;
            votesDueUtc?: string | null;
          } => typeof r.id === 'string' && Number.isFinite(r.number) && typeof r.name === 'string' && r.name.trim() !== '')
          .map((r) => ({
            id: r.id,
            number: r.number,
            name: r.name,
            description: r.description ?? '',
            playlistUrl: r.playlistUrl ?? null,
            submissionsDueUtc: r.submissionsDueUtc ?? null,
            votesDueUtc: r.votesDueUtc ?? null,
          }));
        const liveImport = importLiveRoundsData(getDb(), ctx.slug, ctx.seasonNumber, liveRounds);
        if (liveImport.status === 'error') {
          return fail('import', liveImport.error ?? 'live round reconciliation failed');
        }
        liveRoundsImported = liveImport.roundsCount;
      }
    }
  } catch {
    // fall through to ZIP import; live snapshot is a repair path, not a hard dependency here
  }

  // 4. Import the zip via the existing pipeline. Daemon already dropped it
  //    in the shared volume at data/<slug>/season-<N>/export.zip — read from
  //    the container's view of that path.
  const zipPath = resolve(DATA_DIR, ctx.slug, `season-${ctx.seasonNumber}`, 'export.zip');
  let buf: Buffer;
  try {
    buf = await readFile(zipPath);
  } catch (err) {
    return fail(
      'download',
      `export.zip not readable at ${zipPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const before = countRoundData(roundId);
  let importResult;
  try {
    const parsed = parseZip(buf);
    importResult = importZipData(getDb(), ctx.slug, ctx.seasonNumber, parsed);
  } catch (err) {
    return fail('import', err instanceof Error ? err.message : String(err));
  }
  if (importResult.status === 'error') {
    return fail('import', importResult.error ?? 'import returned error status');
  }

  // Log the import so it shows up in Settings → Import history alongside
  // manual uploads.
  try {
    logImport(getDb(), {
      leagueSlug: ctx.slug,
      seasonNumber: ctx.seasonNumber,
      filename: 'export.zip (cli-trigger)',
      importedAt: new Date().toISOString(),
      ...importResult,
      error: importResult.error ?? null,
    });
  } catch {
    // logging failure shouldn't fail the import response
  }

  const after = countRoundData(roundId);
  const checks = runPrepChecks(getDb(), roundId);

  const body: SuccessBody = {
    ok: true,
    imported: {
      submissions: Math.max(0, after.subs - before.subs),
      votes: Math.max(0, after.votes - before.votes),
      voteComments: Math.max(0, after.comments - before.comments),
    },
    checks,
    durationMs: Date.now() - startedAt,
    mlLeagueId: bridge.mlLeagueId,
    liveRoundsImported,
  };
  return json(body);
};
