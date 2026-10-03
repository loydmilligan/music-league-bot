import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  generateOpenRouterRevealImage,
  revealCaption,
  runRevealAnnouncement,
  type RoundRevealRequest,
} from '../src/reveal/announcement.js';

const request: RoundRevealRequest = {
  leagueSlug: 'second-best', leagueName: 'Second Best & Friends',
  leagueId: 'a'.repeat(32), roundId: 'b'.repeat(32), roundNumber: 1,
  theme: 'Songs About Weather', description: 'Rain, wind, heat, and snow.',
};
const target = '120363406254406895@g.us';

describe('round reveal announcement', () => {
  it('builds a caption with the theme and direct Music League submit link', () => {
    const caption = revealCaption(request);
    expect(caption).toContain('*Songs About Weather*');
    expect(caption).toContain(`https://app.musicleague.com/l/${request.leagueId}/${request.roundId}/submit/`);
  });

  it('does no generation or send unless the dedicated mode is live', async () => {
    const generate = vi.fn();
    const sendMedia = vi.fn();
    const result = await runRevealAnnouncement(request, {
      env: { mode: 'dry-run', targets: { 'second-best': target } }, dataDir: '/tmp', generate,
      sendMedia, sendText: vi.fn(),
    });
    expect(result.sent).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it('writes and sends the generated thumbnail in live mode', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'reveal-send-'));
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const result = await runRevealAnnouncement(request, {
      env: { mode: 'live', targets: { 'second-best': target } }, dataDir,
      generate: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), extension: 'png' }),
      sendMedia, sendText: vi.fn(), now: () => 123,
    });
    expect(result).toMatchObject({ sent: true, media: true });
    expect(await readFile(result.file!)).toEqual(Buffer.from([1, 2, 3]));
    expect(sendMedia).toHaveBeenCalledWith(target, result.file, expect.stringContaining('Songs About Weather'));
  });

  it('falls back to one text message when thumbnail generation fails', async () => {
    const sendText = vi.fn().mockResolvedValue(undefined);
    const result = await runRevealAnnouncement(request, {
      env: { mode: 'live', targets: { 'second-best': target } }, dataDir: '/tmp',
      generate: vi.fn().mockRejectedValue(new Error('image offline')), sendMedia: vi.fn(), sendText,
    });
    expect(result).toMatchObject({ sent: true, media: false });
    expect(result.warning).toMatch(/image offline/);
    expect(sendText).toHaveBeenCalledOnce();
  });

  it('parses the OpenRouter Images API response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'AQID', media_type: 'image/jpeg' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const image = await generateOpenRouterRevealImage('x', { apiKey: 'test', fetchImpl });
    expect(image.extension).toBe('jpg');
    expect([...image.bytes]).toEqual([1, 2, 3]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ prompt: 'x', aspect_ratio: '1:1', n: 1 });
  });
});
