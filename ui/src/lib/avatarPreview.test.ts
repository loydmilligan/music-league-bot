import { describe, it, expect } from 'vitest';
import { basePreviewUrl } from './avatarPreview.js';

// ---------------------------------------------------------------------------
// basePreviewUrl — cache-bust the avatar preview on the server-unique R2 key.
//
// Bug it guards against: the preview used a resettable per-edit counter (?v=0,1,…)
// so a re-upload produced a URL (/api/avatars/2/base?v=1) identical to one the
// browser had already cached (max-age=60) → it served the STALE prior image until
// a remount/refresh. Keying on the unique R2 key makes every version a fresh URL.
// ---------------------------------------------------------------------------

describe('basePreviewUrl', () => {
  it('points at the stable serve endpoint for the player', () => {
    expect(basePreviewUrl(2, '2/base-111.png')).toContain('/api/avatars/2/base');
  });

  it('the SAME key yields the SAME url (cache hits are fine when bytes are unchanged)', () => {
    expect(basePreviewUrl(2, '2/base-111.png')).toBe(basePreviewUrl(2, '2/base-111.png'));
  });

  it('DIFFERENT keys yield DIFFERENT urls (the regression guard — re-upload must bust)', () => {
    const before = basePreviewUrl(2, '2/base-111.png');
    const after = basePreviewUrl(2, '2/base-222.png');
    expect(before).not.toBe(after);
  });

  it('url-encodes the key so the slash is query-safe', () => {
    expect(basePreviewUrl(2, '2/base-111.png')).toBe('/api/avatars/2/base?v=2%2Fbase-111.png');
  });

  it('still produces a usable url when the key is null', () => {
    expect(basePreviewUrl(2, null)).toContain('/api/avatars/2/base');
  });
});
