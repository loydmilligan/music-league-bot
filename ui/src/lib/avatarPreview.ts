/**
 * Build the cache-busting URL for a player's base-avatar preview.
 *
 * The serve endpoint (/api/avatars/:id/base) returns `Cache-Control: max-age=60`
 * over a stable URL, so the preview must include a version token that changes on
 * every new image. Key it on the server-unique R2 key (`{id}/base-{ts}.png`),
 * which is regenerated on every upload/regenerate — so each version is a fresh,
 * never-before-cached URL. (A previous resettable counter reused `?v=1` across
 * edits and collided with the cached prior image.)
 */
export function basePreviewUrl(playerId: number, baseKey: string | null): string {
  const v = baseKey ? encodeURIComponent(baseKey) : '0';
  return `/api/avatars/${playerId}/base?v=${v}`;
}
