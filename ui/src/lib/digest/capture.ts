/**
 * Thin HTTP wrapper around the existing `import-export-zip` endpoint.
 *
 * This intentionally does NOT reimplement the auth-probe / export-zip /
 * import orchestration that lives in
 * `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts`.
 * That endpoint is a live production path and is left untouched; this
 * function simply calls it over HTTP so the digest auto-pipeline runner
 * (a later task) can capture a round's data without duplicating logic.
 */

export type CaptureRoundDataResult =
	| { ok: true; imported: unknown }
	| { ok: false; stage: string; reason: string };

export interface CaptureRoundDataDeps {
	fetchFn?: typeof fetch;
	baseUrl?: string;
}

export async function captureRoundData(
	roundId: number,
	deps: CaptureRoundDataDeps = {}
): Promise<CaptureRoundDataResult> {
	const fetchFn = deps.fetchFn ?? fetch;
	const baseUrl = deps.baseUrl ?? process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';

	try {
		const response = await fetchFn(`${baseUrl}/api/digest/${roundId}/import-export-zip`, {
			method: 'POST'
		});

		const body = await response.json();

		if (body && typeof body === 'object' && body.ok === true) {
			return { ok: true, imported: body.imported };
		}

		if (body && typeof body === 'object' && body.ok === false) {
			return {
				ok: false,
				stage: String(body.stage ?? 'other'),
				reason: String(body.reason ?? 'unknown failure')
			};
		}

		return { ok: false, stage: 'other', reason: 'unexpected response shape from import-export-zip' };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, stage: 'other', reason: message };
	}
}
