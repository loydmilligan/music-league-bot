import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getMlAuthState, probeMlAuth } from '$lib/mlAuth.js';

export const GET: RequestHandler = () => {
	return json(getMlAuthState());
};

export const POST: RequestHandler = async () => {
	const state = await probeMlAuth();
	return json(state);
};
