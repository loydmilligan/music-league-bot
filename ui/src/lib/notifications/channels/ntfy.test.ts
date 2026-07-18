import { describe, it, expect, vi } from 'vitest';
import { ntfyChannel } from './ntfy.js';
import type { AlertPayload } from './types.js';

const cfg = { url: 'https://n', topic: 'mlb', token: 'K' };
const okFetch = () => vi.fn().mockResolvedValue({ ok: true });

describe('ntfyChannel', () => {
  it('declares alert + approval capabilities', () => {
    expect(ntfyChannel.id).toBe('ntfy');
    expect(ntfyChannel.capabilities).toEqual(['alert', 'approval']);
  });
  it('isConfigured requires url + topic', () => {
    expect(ntfyChannel.isConfigured(cfg)).toBe(true);
    expect(ntfyChannel.isConfigured({ url: '', topic: 'x', token: '' })).toBe(false);
    expect(ntfyChannel.isConfigured({})).toBe(false);
  });
  it('plain alert: publishes a notification with title/message/click, returns ok', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = { alertType: 'pipeline_failure', title: 'T', message: 'M', link: 'https://d/x' };
    const r = await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    expect(r.ok).toBe(true);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ topic: 'mlb', title: 'T', message: 'M', click: 'https://d/x' });
    expect(body.actions).toBeFalsy(); // plain alert has no action buttons
  });
  it('digest_ready approve: emits the interactive Approve/Edit/Deny notification with the configured token as bearer', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = {
      alertType: 'digest_ready', title: 'Fam-Jam — R12', message: 'ready', link: 'https://d/x',
      approval: { kind: 'approve', token: 'tok', approveUrl: 'https://a/approve', denyUrl: 'https://a/deny', editUrl: 'https://a/edit' },
    };
    await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.actions.map((a: { label: string }) => a.label)).toEqual(['Approve', 'Edit', 'Deny']);
    const approve = body.actions.find((a: { label: string }) => a.label === 'Approve');
    expect(approve.headers.Authorization).toBe('Bearer K'); // adapter's own configured token
  });
  it('digest_ready review: emits Review/Deny only (no Approve)', async () => {
    const fetchFn = okFetch();
    const p: AlertPayload = {
      alertType: 'digest_ready', title: 'x', message: 'y', link: 'https://d/x',
      approval: { kind: 'review', token: 'tok', denyUrl: 'https://a/deny', editUrl: 'https://a/edit', reviewReason: 'season-final' },
    };
    await ntfyChannel.sendAlert(cfg, p, { fetchFn });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.actions.map((a: { label: string }) => a.label)).toEqual(['Review', 'Deny']);
  });
  it('returns ok:false (never throws) when publish fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await ntfyChannel.sendAlert(cfg, { alertType: 'digest_sent', title: 'T', message: 'M' }, { fetchFn });
    expect(r.ok).toBe(false);
  });
});
