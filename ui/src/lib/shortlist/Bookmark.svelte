<script lang="ts">
  const { spotifyUri, title, artist, album = null, albumArtUrl = null, year = null, durationSec = null, onShortlist = false } = $props<{
    spotifyUri: string;
    title: string;
    artist: string;
    album?: string | null;
    albumArtUrl?: string | null;
    year?: number | null;
    durationSec?: number | null;
    onShortlist?: boolean;
  }>();

  let active = $state(onShortlist);
  let animating = $state(false);

  async function toggle() {
    if (active) {
      await fetch(`/api/shortlist?spotify_uri=${encodeURIComponent(spotifyUri)}`, { method: 'DELETE' });
      active = false;
    } else {
      await fetch('/api/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotify_uri: spotifyUri, title, artist, album: album ?? undefined, album_art_url: albumArtUrl ?? undefined, year: year ?? undefined, duration_sec: durationSec ?? undefined }),
      });
      active = true;
      animating = true;
      setTimeout(() => animating = false, 600);
    }
  }
</script>

<button type="button" class="sl-bookmark" class:is-on={active} class:sl-pop={animating} aria-pressed={active} aria-label={active ? 'Remove from shortlist' : 'Add to shortlist'} onclick={toggle}>
  {active ? '✓' : '+'}
</button>
