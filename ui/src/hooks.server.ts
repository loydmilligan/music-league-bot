import { resolve } from 'node:path';
import { getDb } from '$lib/db/client.js';
import { runStartupImport } from '$lib/import/startupScan.js';
import { startQueueWorker } from '$lib/queueWorker.js';

process.env.DATA_DIR ??= resolve(process.cwd(), '../data');
const DATA_DIR = process.env.DATA_DIR;
const db = getDb();

runStartupImport(db, DATA_DIR).catch((err) =>
	console.error('[startup] import error:', err)
);

startQueueWorker();
