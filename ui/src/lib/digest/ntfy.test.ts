import { describe, it, expect, vi } from 'vitest';
import {
  ntfyConfigFromEnv, buildApprovalNotification, buildReviewNotification,
  buildFailureNotification, publish,
} from './ntfy.js';

describe('ntfyConfigFromEnv', () => {
  it('returns null when url/topic missing', () => {
    expect(ntfyConfigFromEnv({})).toBeNull();
    expect(ntfyConfigFromEnv({ NTFY_URL: 'https://n' })).toBeNull();
  });
  it('reads url/topic/token from env', () => {
    expect(ntfyConfigFromEnv({ NTFY_URL: 'https://n', NTFY_TOPIC: 't', NTFY_TOKEN: 'k' }))
      .toEqual({ url: 'https://n', topic: 't', token: 'k' });
  });
});

describe('buildApprovalNotification', () => {
  const n = buildApprovalNotification({
    league: 'Fam Jam', round: 'Round 12', reviewUrl: 'https://d/x',
    approveUrl: 'https://mlb37/api/digest/approve', denyUrl: 'https://mlb37/api/digest/deny',
    editUrl: 'https://mlb37/digest/12', token: 'tok', bearer: 'BR',
  });
  it('titles with league + round and clicks through to the review link', () => {
    expect(n.title).toContain('Fam Jam'); expect(n.title).toContain('Round 12');
    expect(n.click).toBe('https://d/x');
  });
  it('has exactly Approve / Edit / Deny actions', () => {
    expect(n.actions?.map((a) => a.label)).toEqual(['Approve', 'Edit', 'Deny']);
  });
  it('Approve+Deny are token-authed http POSTs carrying the bearer', () => {
    const approve = n.actions!.find((a) => a.label === 'Approve')!;
    expect(approve.action).toBe('http'); expect(approve.method).toBe('POST');
    expect(approve.url).toContain('/approve');
    expect(approve.headers?.Authorization).toBe('Bearer BR');
    expect(approve.body).toContain('tok');
  });
  it('Edit is a view action to the editor', () => {
    const edit = n.actions!.find((a) => a.label === 'Edit')!;
    expect(edit.action).toBe('view'); expect(edit.url).toBe('https://mlb37/digest/12');
  });
});

describe('buildReviewNotification', () => {
  const n = buildReviewNotification({
    league: 'Fam Jam', round: 'Round 12', reviewUrl: 'https://d/x',
    editUrl: 'https://mlb37/digest/12', denyUrl: 'https://mlb37/api/digest/deny',
    token: 'tok', reason: 'season-final round', bearer: 'BR',
  });
  it('mentions the reason and has NO Approve action', () => {
    expect(n.message).toMatch(/season-final/i);
    expect(n.actions?.map((a) => a.label)).toEqual(['Review', 'Deny']);
    expect(n.actions?.some((a) => a.label === 'Approve')).toBe(false);
  });
});

describe('buildFailureNotification', () => {
  it('carries stage + reason', () => {
    const n = buildFailureNotification({ stage: 'capture', reason: 'ML auth expired', roundId: 7 });
    expect(n.title).toMatch(/digest/i);
    expect(n.message).toContain('capture'); expect(n.message).toContain('ML auth expired');
  });
});

describe('publish', () => {
  it('POSTs to base url with topic + bearer and returns true on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    const ok = await publish({ url: 'https://n', topic: 't', token: 'k' },
      { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch);
    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    // ntfy JSON publish posts to the ROOT url; the topic travels in the body.
    expect(url).toBe('https://n');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: 't', title: 'T', message: 'M' });
  });
  it('returns false (never throws) when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    await expect(publish({ url: 'https://n', topic: 't' }, { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch))
      .resolves.toBe(false);
  });
  it('returns false on a non-2xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(publish({ url: 'https://n', topic: 't' }, { title: 'T', message: 'M' }, fetchFn as unknown as typeof fetch))
      .resolves.toBe(false);
  });
});
