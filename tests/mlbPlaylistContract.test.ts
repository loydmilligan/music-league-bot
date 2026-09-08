import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlaylistPageHtml } from '../ui/src/lib/ytm/playlistPage.js';
import type { VideoPick } from '../ui/src/lib/ytm/videoReview.js';

const ROOT = path.resolve(__dirname, '..');

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 'Song', artists: 'Artist', spotifyUri: 'u:1', source: 'search', score: 80, band: 'auto',
    candidates: [{ videoId: 'V1', title: 'Vid', channel: 'Chan', score: 80 }],
    chosen: ['V1'], included: true, decided: true, reason: null, ...over,
  };
}

/**
 * These are the seams the four slices were built across. Each was written by an
 * agent that could not see the others, and every one of these assertions
 * corresponds to a real defect that shipped: the page posted to URLs the routes
 * did not serve, and the Caddyfile documented an API that did not exist.
 */
describe('page ↔ endpoint URL contract', () => {
  const html = buildPlaylistPageHtml({
    roundName: 'R', leagueTitle: 'L', slug: 'SLUG123', picks: [pick({})],
    roster: [{ id: 1, name: 'Matt Mariani' }], tallies: [],
  } as never);

  it('posts to /api/p/<slug>/<action>, the shape the routes actually serve', () => {
    // The bug: posting to `${API}/${action}` resolves to the read-model route
    // with the action as its slug, and 405s on every write.
    expect(html).toContain("API + '/' + encodeURIComponent(SLUG) + '/' + action");
  });

  it('only uses actions that have a route file', () => {
    const actions = [...html.matchAll(/post\('([a-z]+)'/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of new Set(actions)) {
      const route = path.join(ROOT, 'ui/src/routes/api/p/[slug]', a, '+server.ts');
      expect(fs.existsSync(route), `page posts '${a}' but ${route} does not exist`).toBe(true);
    }
  });

  it('every write route it calls actually exports POST', () => {
    for (const a of new Set([...html.matchAll(/post\('([a-z]+)'/g)].map((m) => m[1]))) {
      const src = fs.readFileSync(path.join(ROOT, 'ui/src/routes/api/p/[slug]', a, '+server.ts'), 'utf8');
      expect(src, `${a} route has no POST`).toMatch(/export const POST/);
    }
  });
});

describe('the public host proxies only the playlist API', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'Caddyfile.digest'), 'utf8');
  // Comments discuss reverse_proxy at length — count directives, not prose.
  const caddy = raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it('has exactly one reverse_proxy', () => {
    // digest.mattmariani.com has NO Cloudflare Access in front of it. A second
    // proxy, or a broader matcher, puts the admin app on the public internet.
    expect(caddy.match(/reverse_proxy/g) ?? []).toHaveLength(1);
  });

  it('scopes that proxy to /api/p/* and nothing wider', () => {
    // The proxy sits inside a nested `route {}`, so match the innermost
    // enclosing `handle` by taking the last one declared before it rather than
    // trying to balance braces.
    const upto = caddy.slice(0, caddy.indexOf('reverse_proxy'));
    const handles = [...upto.matchAll(/handle\s+(\/[^\s{]*)\s*\{/g)].map((m) => m[1]);
    expect(handles.at(-1)).toBe('/api/p/*');
  });

  it('still serves every namespace that shipped before it', () => {
    for (const route of ['/d/*', '/_media/*', '/_bside/*', '/p/*']) {
      expect(caddy, `lost the ${route} namespace`).toContain(`handle ${route}`);
    }
  });
});

describe('the static page refreshes its own tallies', () => {
  const html = buildPlaylistPageHtml({
    roundName: 'R', leagueTitle: 'L', slug: 'S', picks: [pick({})],
    roster: [{ id: '1', name: 'Matt Mariani' }], tallies: [],
  } as never);

  it('fetches the read model on load', () => {
    // Baked-in tallies are frozen at render time. Without this, one person's
    // vote is invisible to everyone else until the page is regenerated — which
    // makes a shared voting page pointless.
    expect(html).toMatch(/fetch\(API \+ '\/' \+ encodeURIComponent\(SLUG\)/);
  });

  it('paints the count into the up and down buttons separately', () => {
    expect(html).toContain("b.dataset.dir === 'up' ? t.up : t.down");
  });

  it('renders the hooks that hydration depends on', () => {
    expect(html).toMatch(/class="vote up" data-v="[^"]+" data-dir="up"/);
    expect(html).toContain('class="n"');
  });
});
