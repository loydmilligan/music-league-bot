import { describe, it, expect } from 'vitest';
import { parseControlRequest } from '../src/control/router.js';

const GROUP = '120363426590199032@g.us';

describe('parseControlRequest', () => {
  it('routes POST /trigger to a scheduled poll', () => {
    expect(parseControlRequest('POST', '/trigger', {})).toEqual({ action: 'trigger' });
  });

  it('routes a validated round reveal request', () => {
    expect(parseControlRequest('POST', '/round-reveal', {
      leagueSlug: 'second-best', leagueName: 'Second Best', leagueId: 'a'.repeat(32),
      roundId: 'b'.repeat(32), roundNumber: 1, theme: 'Songs About Weather', description: 'Rain or shine.',
    })).toEqual({
      action: 'round-reveal', leagueSlug: 'second-best', leagueName: 'Second Best', leagueId: 'a'.repeat(32),
      roundId: 'b'.repeat(32), roundNumber: 1, theme: 'Songs About Weather', description: 'Rain or shine.',
    });
  });

  it('rejects malformed round reveal ids and positions', () => {
    const base = { leagueSlug: 'second-best', leagueName: 'Second Best', leagueId: 'a'.repeat(32), roundId: 'b'.repeat(32), roundNumber: 1, theme: 'T' };
    expect(parseControlRequest('POST', '/round-reveal', { ...base, roundId: 'nope' }).action).toBe('unknown');
    expect(parseControlRequest('POST', '/round-reveal', { ...base, roundNumber: 0 }).action).toBe('unknown');
  });

  it('routes POST /send with a full body', () => {
    const r = parseControlRequest('POST', '/send', { roundId: 132, target: GROUP, mode: 'live' });
    expect(r).toEqual({ action: 'send', roundId: 132, target: GROUP, mode: 'live' });
  });

  it('defaults an omitted mode to dry-run — never send by accident', () => {
    const r = parseControlRequest('POST', '/send', { roundId: 132, target: GROUP });
    expect(r).toMatchObject({ action: 'send', mode: 'dry-run' });
  });

  it('treats any non-live mode as dry-run', () => {
    const r = parseControlRequest('POST', '/send', { roundId: 132, target: GROUP, mode: 'LIVE' });
    expect(r).toMatchObject({ mode: 'dry-run' });
  });

  it('rejects a send with no roundId', () => {
    const r = parseControlRequest('POST', '/send', { target: GROUP, mode: 'live' });
    expect(r.action).toBe('unknown');
  });

  it('rejects a send whose roundId is not a number', () => {
    const r = parseControlRequest('POST', '/send', { roundId: '132', target: GROUP });
    expect(r.action).toBe('unknown');
  });

  it('rejects a send with no target', () => {
    const r = parseControlRequest('POST', '/send', { roundId: 132 });
    expect(r.action).toBe('unknown');
  });

  it('rejects the wrong method on a known path', () => {
    expect(parseControlRequest('GET', '/trigger', {}).action).toBe('unknown');
  });

  it('rejects an unknown path', () => {
    expect(parseControlRequest('POST', '/nope', {}).action).toBe('unknown');
  });

  it('parses POST /notify with a text body', () => {
    expect(parseControlRequest('POST', '/notify', { text: 'hello' })).toEqual({ action: 'notify', text: 'hello' });
  });

  it('rejects /notify without a non-empty text', () => {
    expect(parseControlRequest('POST', '/notify', {}).action).toBe('unknown');
    expect(parseControlRequest('POST', '/notify', { text: '  ' }).action).toBe('unknown');
  });
});
