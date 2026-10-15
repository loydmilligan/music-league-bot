import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { parseControlRequest } from '../src/control/router.js';
import {
  createLoginCodeService,
  lookupPlayerNumber,
  normalizeName,
  pickWhatsAppNumber,
  LOGIN_NAME_ALIASES,
  type LoginCodeLookup,
} from '../src/whatsapp/loginCode.js';

// Fixture numbers are 555 fakes. The player's real number and the redirect
// target deliberately differ so a redirect test cannot pass by accident.
const SHANE = '+13105550101';
const MATT_REDIRECT = '+16615550199';

function fixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE player_identities (
      id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, league_id INTEGER,
      identity_type TEXT NOT NULL, identifier TEXT NOT NULL
    );
    INSERT INTO players (id, name) VALUES (1, 'Shane Farkas'), (2, 'Jimmy'), (3, 'Grant Koziol'), (4, 'JP Nobody');
    INSERT INTO player_identities (player_id, identity_type, identifier) VALUES
      (1, 'whatsapp', '~ Shane'),
      (1, 'whatsapp', 'Shane Farkas'),
      (1, 'whatsapp', '${SHANE}'),
      (1, 'music-league', '+19999999999'),
      (2, 'whatsapp', '~ Jimmy'),
      (2, 'whatsapp', '+13105550202'),
      (3, 'whatsapp', '~ Grant'),
      (3, 'whatsapp', '+1 (786) 555-0303'),
      (4, 'whatsapp', 'JP');
  `);
  return db;
}

function fakeSender() {
  const sent: { target: string; text: string }[] = [];
  return { sent, send: async (target: string, text: string) => { sent.push({ target, text }); } };
}

describe('login-code name + number resolution', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeName('  shane   FARKAS ')).toBe('shane farkas');
    expect(normalizeName('Jimmy Troy')).toBe('jimmy troy');
  });

  it('ignores name-only identifiers and normalizes formatted numbers to E.164', () => {
    expect(pickWhatsAppNumber(['~ Grant', '+1 (786) 555-0303'])).toBe('+17865550303');
    expect(pickWhatsAppNumber(['~ Jimmy', 'Jimmy Troy'])).toBeNull();
  });

  it('resolves exact name, alias, and reports missing numbers', () => {
    const db = fixtureDb();
    expect(LOGIN_NAME_ALIASES['jimmy troy']).toBe('Jimmy');
    expect(lookupPlayerNumber(db, 'shane farkas')).toEqual({ player: 'Shane Farkas', e164: SHANE });
    expect(lookupPlayerNumber(db, 'Jimmy Troy')).toEqual({ player: 'Jimmy', e164: '+13105550202' });
    expect(lookupPlayerNumber(db, 'Grant Koziol')).toEqual({ player: 'Grant Koziol', e164: '+17865550303' });
    expect(lookupPlayerNumber(db, 'JP Nobody')).toEqual({ player: 'JP Nobody', e164: null });
    expect(lookupPlayerNumber(db, 'Shane')).toBeNull(); // no fuzzy/prefix match
  });
});

describe('login-code service', () => {
  const lookup: LoginCodeLookup = (name) => lookupPlayerNumber(fixtureDb(), name);

  it('DMs the code to the player number with the spec text, never returning the number', async () => {
    const s = fakeSender();
    const svc = createLoginCodeService({ lookup, send: s.send, redirect: undefined });
    const res = await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '123456' });
    expect(res).toEqual({ sent: true });
    expect(JSON.stringify(res)).not.toContain('555');
    expect(s.sent).toEqual([{
      target: '13105550101@c.us',
      text: 'Your Music League portal code is 123456. It expires in 10 minutes.',
    }]);
  });

  it('LOGIN_CODE_REDIRECT sends only to the redirect target, prefixed with the player name', async () => {
    const s = fakeSender();
    const svc = createLoginCodeService({ lookup, send: s.send, redirect: MATT_REDIRECT });
    expect(await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '654321' })).toEqual({ sent: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].target).toBe('16615550199@c.us');
    expect(s.sent[0].target).not.toContain('13105550101');
    expect(s.sent[0].text).toBe('[TEST → Shane Farkas] Your Music League portal code is 654321. It expires in 10 minutes.');
  });

  it('an invalid redirect fails closed instead of falling back to the real number', async () => {
    const s = fakeSender();
    const svc = createLoginCodeService({ lookup, send: s.send, redirect: 'not-a-number' });
    expect(await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '654321' }))
      .toEqual({ sent: false, reason: 'send_failed' });
    expect(s.sent).toEqual([]);
  });

  it('reports unknown_player and no_number without sending', async () => {
    const s = fakeSender();
    const svc = createLoginCodeService({ lookup, send: s.send, redirect: MATT_REDIRECT });
    expect(await svc.request({ league: 'boarz', name: 'Nobody', code: '111111' }))
      .toEqual({ sent: false, reason: 'unknown_player' });
    expect(await svc.request({ league: 'boarz', name: 'JP Nobody', code: '111111' }))
      .toEqual({ sent: false, reason: 'no_number' });
    expect(s.sent).toEqual([]);
  });

  it('rate-limits to 3 codes per player per hour, per player, and recovers after the hour', async () => {
    const s = fakeSender();
    let t = 1_000_000;
    const svc = createLoginCodeService({ lookup, send: s.send, redirect: undefined, now: () => t });
    for (let i = 0; i < 3; i++) {
      expect(await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '123456' })).toEqual({ sent: true });
      t += 60_000;
    }
    expect(await svc.request({ league: 'boarz', name: 'shane farkas', code: '123456' }))
      .toEqual({ sent: false, reason: 'rate_limited' });
    expect(s.sent).toHaveLength(3);
    // another player is unaffected
    expect(await svc.request({ league: 'boarz', name: 'Jimmy Troy', code: '123456' })).toEqual({ sent: true });
    // first send was at t0; one hour after it a slot frees up
    t = 1_000_000 + 60 * 60_000 + 1;
    expect(await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '123456' })).toEqual({ sent: true });
  });

  it('a failed send reports send_failed and does not consume a rate-limit slot', async () => {
    let calls = 0;
    const svc = createLoginCodeService({
      lookup,
      send: async () => { calls++; throw new Error('client not ready'); },
      redirect: undefined,
    });
    for (let i = 0; i < 4; i++) {
      expect(await svc.request({ league: 'boarz', name: 'Shane Farkas', code: '123456' }))
        .toEqual({ sent: false, reason: 'send_failed' });
    }
    expect(calls).toBe(4);
  });
});

describe('POST /login-code routing', () => {
  it('parses a valid body', () => {
    expect(parseControlRequest('POST', '/login-code', { league: 'boarz', name: ' Shane Farkas ', code: '012345' }))
      .toEqual({ action: 'login-code', league: 'boarz', name: 'Shane Farkas', code: '012345' });
  });

  it('rejects missing name/league and non-6-digit codes', () => {
    expect(parseControlRequest('POST', '/login-code', { league: 'boarz', code: '123456' }).action).toBe('unknown');
    expect(parseControlRequest('POST', '/login-code', { name: 'X', code: '123456' }).action).toBe('unknown');
    expect(parseControlRequest('POST', '/login-code', { league: 'boarz', name: 'X', code: '12345' }).action).toBe('unknown');
    expect(parseControlRequest('POST', '/login-code', { league: 'boarz', name: 'X', code: 123456 }).action).toBe('unknown');
    expect(parseControlRequest('GET', '/login-code', {}).action).toBe('unknown');
  });
});
