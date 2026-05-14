import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getQueueStatus } from '$lib/db/ytmQueue.js';

export const GET: RequestHandler = async () => json(getQueueStatus(getDb()));
