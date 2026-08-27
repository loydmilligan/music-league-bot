import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { listNotes, addNote, updateNote, deleteNote, isNoteTarget } from '$lib/digest/roundNotes.js';

const roundOf = (params: { roundId: string }): number => {
  const n = Number(params.roundId);
  if (!Number.isInteger(n) || n <= 0) throw error(400, 'invalid roundId');
  return n;
};

export const GET: RequestHandler = ({ params }) =>
  json({ notes: listNotes(getDb(), roundOf(params as { roundId: string })) });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = roundOf(params as { roundId: string });
  const { target, body } = (await request.json()) as { target?: unknown; body?: unknown };
  if (!isNoteTarget(target)) throw error(400, `unknown note target "${String(target)}"`);
  if (typeof body !== 'string' || !body.trim()) throw error(400, 'body is required');
  return json({ note: addNote(getDb(), roundId, target, body.trim(), new Date().toISOString()) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  roundOf(params as { roundId: string });
  const { id, target, body } = (await request.json()) as { id?: string; target?: unknown; body?: unknown };
  if (!id) throw error(400, 'id is required');
  if (target !== undefined && !isNoteTarget(target)) throw error(400, 'unknown note target');
  if (body !== undefined && (typeof body !== 'string' || !body.trim())) throw error(400, 'body cannot be empty');
  const note = updateNote(getDb(), id,
    { target: target as never, body: typeof body === 'string' ? body.trim() : undefined },
    new Date().toISOString());
  if (!note) throw error(404, 'unknown note');
  return json({ note });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  roundOf(params as { roundId: string });
  const { id } = (await request.json()) as { id?: string };
  if (!id) throw error(400, 'id is required');
  if (!deleteNote(getDb(), id)) throw error(404, 'unknown note');
  return json({ ok: true });
};
