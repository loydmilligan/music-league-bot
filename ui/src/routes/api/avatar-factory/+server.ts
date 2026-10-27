import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	createTheme,
	updateTheme,
	generateOptions,
	pickSourcePhoto,
	publicState,
	requestGroupShot,
	runRescan,
	setMemberNotes,
	setRating,
	setStatus,
	uploadPhoto,
} from '$lib/server/avatarFactory/actions.js';
import { brainstormTheme, buildThemePrompt, suggestThemes } from '$lib/server/avatarFactory/brainstorm.js';
import { startImplementStyle } from '$lib/server/avatarFactory/implementStyle.js';
import { PathGuardError } from '$lib/server/avatarFactory/paths.js';
import { BOARZ_LEAGUE_SLUG } from '$lib/server/avatarFactory/notes.js';
import { ProviderError } from '$lib/server/avatarFactory/errors.js';

function fail(e: unknown, fallback = 500): never {
	if (isHttpError(e)) throw e;
	if (e instanceof PathGuardError) error(400, e.message);
	if (e instanceof ProviderError) error(e.httpStatus, e.userMessage);
	const msg = e instanceof Error ? e.message : 'error';
	if (/paused/i.test(msg)) error(503, msg);
	if (
		/locked|not found|invalid|too large|not an image|rating|not enabled|needs key|disabled pending|unknown provider|confirm required|missing photos|already in progress|NTFY_URL|no members/i.test(
			msg,
		)
	)
		error(400, msg);
	error(fallback, msg);
}

export const GET: RequestHandler = async ({ url }) => {
	const league = url.searchParams.get('league') || BOARZ_LEAGUE_SLUG;
	try {
		return json(publicState(league));
	} catch (e) {
		fail(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const ct = request.headers.get('content-type') ?? '';
	try {
		if (ct.includes('multipart/form-data')) {
			const form = await request.formData();
			const leagueSlug = String(form.get('leagueSlug') ?? '');
			const memberSlug = String(form.get('memberSlug') ?? '');
			const file = form.get('file');
			if (!(file instanceof File)) error(400, 'file required');
			const buf = new Uint8Array(await file.arrayBuffer());
			return json(uploadPhoto(leagueSlug, memberSlug, buf, file.name));
		}

		const body = (await request.json()) as Record<string, unknown>;
		const action = String(body.action ?? '');
		switch (action) {
			case 'rescan':
				return json(runRescan());
			case 'rate':
				return json(
					setRating(
						String(body.leagueSlug),
						String(body.memberSlug),
						String(body.candidateId),
						Number(body.rating),
						{},
						body.comment != null ? String(body.comment) : undefined,
					),
				);
			case 'approve':
				return json(setStatus(String(body.leagueSlug), String(body.memberSlug), String(body.candidateId), 'approved'));
			case 'reject':
				return json(setStatus(String(body.leagueSlug), String(body.memberSlug), String(body.candidateId), 'rejected'));
			case 'notes':
				return json(setMemberNotes(String(body.leagueSlug), String(body.memberSlug), String(body.notes ?? '')));
			case 'pick-photo':
				return json(pickSourcePhoto(String(body.leagueSlug), String(body.memberSlug), String(body.sourceRel)));
			case 'create-theme':
				return json(
					createTheme({
						slug: String(body.slug ?? ''),
						name: String(body.name ?? ''),
						prompt: String(body.prompt ?? ''),
						...(body.attachInspiration != null ? { attachInspiration: body.attachInspiration === true } : {}),
					}),
				);
			case 'update-theme':
				return json(
					updateTheme(String(body.slug ?? ''), {
						name: body.name != null ? String(body.name) : undefined,
						prompt: body.prompt != null ? String(body.prompt) : undefined,
					}),
				);
			case 'generate':
				return json(
					await generateOptions({
						leagueSlug: String(body.leagueSlug),
						themeSlug: String(body.themeSlug),
						memberSlug: String(body.memberSlug),
						count: body.count as number | undefined,
						provider: body.provider ? String(body.provider) : undefined,
						confirmed: body.confirmed === true,
					}),
				);
			case 'tweak':
				return json(
					await generateOptions({
						leagueSlug: String(body.leagueSlug),
						themeSlug: String(body.themeSlug),
						memberSlug: String(body.memberSlug),
						count: 1,
						tweakNote: String(body.tweakNote ?? ''),
						baseCandidateId: body.candidateId ? String(body.candidateId) : undefined,
						provider: body.provider ? String(body.provider) : undefined,
						confirmed: body.confirmed === true,
					}),
				);
			case 'group-shot':
				return json(
					await requestGroupShot({
						leagueSlug: String(body.leagueSlug),
						themeSlug: String(body.themeSlug),
						provider: body.provider ? String(body.provider) : undefined,
						confirmed: body.confirmed === true,
					}),
				);
			case 'brainstorm-theme':
				return json(
					await brainstormTheme({
						idea: body.idea != null ? String(body.idea) : undefined,
						leagueSlug: body.leagueSlug ? String(body.leagueSlug) : undefined,
					}),
				);
			case 'suggest-themes':
				return json(
					await suggestThemes({
						idea: body.idea != null ? String(body.idea) : undefined,
						leagueSlug: body.leagueSlug ? String(body.leagueSlug) : undefined,
						count: body.count != null ? Number(body.count) : undefined,
					}),
				);
			case 'build-theme-prompt':
				return json(
					await buildThemePrompt({
						name: body.name != null ? String(body.name) : undefined,
						idea: body.idea != null ? String(body.idea) : undefined,
						notes: body.notes != null ? String(body.notes) : undefined,
						prompt: body.prompt != null ? String(body.prompt) : undefined,
						leagueSlug: body.leagueSlug ? String(body.leagueSlug) : undefined,
					}),
				);
			case 'implement-style':
				return json(
					await startImplementStyle({
						leagueSlug: String(body.leagueSlug),
						themeSlug: String(body.themeSlug),
						provider: body.provider ? String(body.provider) : undefined,
					}),
				);
			default:
				error(400, 'unknown action');
		}
	} catch (e) {
		fail(e);
	}
};
