import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { botUiFetch } from '../httpClient.js';

const ratingsShape = {
  discovery: z.number().min(0).max(5).optional(),
  themeFit: z.number().min(0).max(5).optional(),
  quality: z.number().min(0).max(5).optional(),
  replayability: z.number().min(0).max(5).optional(),
};

export interface RatingsInput {
  discovery?: number;
  themeFit?: number;
  quality?: number;
  replayability?: number;
}

export interface AddSongToRoundInput {
  roundId: number;
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string;
  notes?: string;
  ratings?: RatingsInput;
}

export async function addSongToRound(input: AddSongToRoundInput) {
  return botUiFetch(`/api/rounds/${input.roundId}/research-songs`, {
    method: 'POST',
    body: JSON.stringify({
      spotifyUri: input.spotifyUri, title: input.title, artist: input.artist, album: input.album,
      notes: input.notes,
      ratings: input.ratings && {
        discoveryPotential: input.ratings.discovery,
        themeFit: input.ratings.themeFit,
        quality: input.ratings.quality,
        replayability: input.ratings.replayability,
      },
    }),
  });
}

export interface AddSongToShortlistInput {
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string;
}

export async function addSongToShortlist(input: AddSongToShortlistInput) {
  return botUiFetch('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      spotify_uri: input.spotifyUri, title: input.title, artist: input.artist, album: input.album,
    }),
  });
}

export interface UpdateSongInput {
  researchSongId: number;
  roundId: number;
  notes?: string;
  ratings?: RatingsInput;
}

export async function updateSong(input: UpdateSongInput) {
  const body: Record<string, unknown> = { id: input.researchSongId };
  if (input.notes !== undefined) body.notes = input.notes;
  if (input.ratings?.discovery !== undefined) body.discoveryPotential = input.ratings.discovery;
  if (input.ratings?.themeFit !== undefined) body.themeFit = input.ratings.themeFit;
  if (input.ratings?.quality !== undefined) body.quality = input.ratings.quality;
  if (input.ratings?.replayability !== undefined) body.replayability = input.ratings.replayability;
  return botUiFetch(`/api/research/${input.roundId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface RemoveSongFromRoundInput {
  researchSongId: number;
  roundId: number;
}

export async function removeSongFromRound(input: RemoveSongFromRoundInput) {
  return botUiFetch(`/api/research/${input.roundId}`, {
    method: 'PATCH',
    body: JSON.stringify({ id: input.researchSongId, removedReason: 'user_removed', removedAt: new Date().toISOString() }),
  });
}

export interface ListRoundSongsInput {
  roundId: number;
  includeRemoved?: boolean;
}

export async function listRoundSongs(input: ListRoundSongsInput) {
  const query = input.includeRemoved ? '?includeRemoved=true' : '';
  return botUiFetch(`/api/research/${input.roundId}${query}`);
}

export function registerSongTools(server: McpServer): void {
  server.tool(
    'add_song_to_round',
    "Add a song to a round's active research/candidate list. Also ensures it exists on the global shortlist.",
    {
      roundId: z.number().int(), spotifyUri: z.string(), title: z.string(), artist: z.string(),
      album: z.string().optional(), notes: z.string().optional(),
      ratings: z.object(ratingsShape).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await addSongToRound(input)) }] }),
  );

  server.tool(
    'add_song_to_shortlist',
    'Add a song to the global shortlist only (no round association).',
    { spotifyUri: z.string(), title: z.string(), artist: z.string(), album: z.string().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await addSongToShortlist(input)) }] }),
  );

  server.tool(
    'update_song',
    "Update a song's notes and/or ratings on a round's research list.",
    {
      researchSongId: z.number().int(), roundId: z.number().int(),
      notes: z.string().optional(), ratings: z.object(ratingsShape).optional(),
    },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await updateSong(input)) }] }),
  );

  server.tool(
    'remove_song_from_round',
    "Remove a song from a round's active research list (soft-remove, reason recorded as user_removed).",
    { researchSongId: z.number().int(), roundId: z.number().int() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await removeSongFromRound(input)) }] }),
  );

  server.tool(
    'list_round_songs',
    "List a round's research/candidate songs.",
    { roundId: z.number().int(), includeRemoved: z.boolean().optional() },
    async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await listRoundSongs(input)) }] }),
  );
}
