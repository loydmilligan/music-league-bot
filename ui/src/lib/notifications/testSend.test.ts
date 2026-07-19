import { describe, it, expect } from 'vitest';
import { buildTestPayload, mergePreservingSecrets } from './testSend.js';

describe('buildTestPayload', () => {
  it('builds a recognizable test alert', () => {
    const p = buildTestPayload();
    expect(p.alertType).toBe('pipeline_failure');
    expect(p.title.toLowerCase()).toContain('test');
  });
});

describe('mergePreservingSecrets', () => {
  it('keeps the stored secret when the incoming secret field is blank', () => {
    const stored = { channels: { ntfy: { url: 'u', topic: 't', token: 'SECRET' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    const incoming = { channels: { ntfy: { url: 'u2', topic: 't2', token: '' }, whatsapp: { ownerNumber: 'o2' } }, routing: {} as never };
    const merged = mergePreservingSecrets(stored as never, incoming as never);
    expect(merged.channels.ntfy.token).toBe('SECRET'); // blank kept
    expect(merged.channels.ntfy.url).toBe('u2');        // non-secret updated
  });
  it('overwrites the secret when a new value is supplied', () => {
    const stored = { channels: { ntfy: { url: 'u', topic: 't', token: 'OLD' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    const incoming = { channels: { ntfy: { url: 'u', topic: 't', token: 'NEW' }, whatsapp: { ownerNumber: 'o' } }, routing: {} as never };
    expect(mergePreservingSecrets(stored as never, incoming as never).channels.ntfy.token).toBe('NEW');
  });
});
