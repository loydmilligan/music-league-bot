import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { recomputePopularityProxies } from './lastfm.js';

function db0() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE song_popularity (
    spotify_uri TEXT PRIMARY KEY, artist TEXT, title TEXT,
    listeners INTEGER, playcount INTEGER, popularity_proxy INTEGER,
    spotify_popularity INTEGER, fetched_at TEXT, tags TEXT, popularity_source TEXT);`);
  return db;
}
const ins = (db: Database.Database, uri: string, playcount: number | null, spotifyPop: number | null, source: string | null = null, proxy: number | null = null) =>
  db.prepare(`INSERT INTO song_popularity (spotify_uri, listeners, playcount, spotify_popularity, popularity_source, popularity_proxy) VALUES (?,?,?,?,?,?)`)
    .run(uri, playcount ?? 0, playcount, spotifyPop, source, proxy);

it('produces a near-uniform 0..100 distribution from skewed inputs', async () => {
  const db = db0();
  // exponentially-skewed playcounts (like real data)
  for (let i = 0; i < 100; i++) ins(db, `spotify:track:p${i}`, Math.round(Math.exp(i / 10)), null);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const vals = (db.prepare('SELECT popularity_proxy p FROM song_popularity').all() as { p: number }[]).map(r => r.p);
  expect(Math.min(...vals)).toBeLessThan(10);
  expect(Math.max(...vals)).toBeGreaterThan(90);
  // uniform: each quartile band holds a comparable share (not clustered at the top)
  const band = (lo: number, hi: number) => vals.filter(v => v >= lo && v < hi).length;
  for (const [lo, hi] of [[0,25],[25,50],[50,75],[75,101]] as const) {
    expect(band(lo, hi)).toBeGreaterThan(10); // ~25 each; skewed log-norm would fail low bands
  }
});

it('calibrates spotify-only songs onto the last.fm ranking (obscure stays low)', async () => {
  const db = db0();
  // overlap: lf grows with spotify popularity (monotonic relationship)
  for (let i = 0; i < 20; i++) ins(db, `spotify:track:o${i}`, Math.round(Math.exp(i / 3)), i * 5); // spotifyPop 0..95
  // spotify-only obscure song (low spotify popularity, no lastfm)
  ins(db, 'spotify:track:obscure', null, 3);
  // spotify-only popular song
  ins(db, 'spotify:track:hit', null, 92);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const p = (u: string) => (db.prepare('SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri=?').get(u) as { p: number; s: string });
  expect(p('spotify:track:obscure').s).toBe('spotify');
  expect(p('spotify:track:hit').s).toBe('spotify');
  expect(p('spotify:track:obscure').p).toBeLessThan(p('spotify:track:hit').p); // obscure ranks below hit
});

it('never overwrites manual entries and is idempotent', async () => {
  const db = db0();
  ins(db, 'spotify:track:m', 1000, 80, 'manual', 33);
  ins(db, 'spotify:track:a', 5000, null);
  ins(db, 'spotify:track:b', 50, null);
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const first = db.prepare('SELECT spotify_uri, popularity_proxy, popularity_source FROM song_popularity ORDER BY spotify_uri').all();
  await recomputePopularityProxies(db, { fetchSpotify: false });
  const second = db.prepare('SELECT spotify_uri, popularity_proxy, popularity_source FROM song_popularity ORDER BY spotify_uri').all();
  expect(second).toEqual(first); // idempotent
  const m = db.prepare("SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri='spotify:track:m'").get() as { p: number; s: string };
  expect(m).toEqual({ p: 33, s: 'manual' }); // untouched
});

it('leaves signal-less songs null', async () => {
  const db = db0();
  ins(db, 'spotify:track:none', null, null);
  ins(db, 'spotify:track:has', 100, null);
  const res = await recomputePopularityProxies(db, { fetchSpotify: false });
  const none = db.prepare("SELECT popularity_proxy p, popularity_source s FROM song_popularity WHERE spotify_uri='spotify:track:none'").get() as { p: number | null; s: string | null };
  expect(none.p).toBeNull();
  expect(none.s).toBeNull();
  expect(res.nullRemaining).toBe(1);
});
