<script lang="ts">
  import SongCard from '$lib/song/SongCard.svelte';
  import AssignPopover from '$lib/shortlist/AssignPopover.svelte';
  import { adapters } from '$lib/song/adapters.js';
  import type { SongCardConfig } from '$lib/song/canonical.js';
  import type { ChatSong } from './chat.js';

  const { song, open = false, ontoggle, onupdated } = $props<{
    song: ChatSong;
    open?: boolean;
    ontoggle: () => void;
    onupdated: (updated: Partial<ChatSong> & { id: string }) => void;
  }>();

  let localSong = $state({ ...song });
  let showAssignPopover = $state(false);
  let dismissConfirm = $state(false);

  const assignedRoundIds = $derived(localSong.assignedRoundIds ?? []);

  const cardSong = $derived(
    adapters.fromChat(localSong as unknown as Record<string, unknown>)
  );

  const CW_CONFIG: SongCardConfig = {
    art: true,
    layers: ['state', 'chat'],
    actions: ['play', 'shortlist', 'assign', 'dismiss'],
    actionStyle: 'inline',
    accent: 'sky',
    mobileTrailing: 'none',
  };

  async function handleAction(actionId: string) {
    if (actionId === 'play') {
      const trackId = localSong.spotifyUri?.split(':').at(-1);
      if (trackId) window.open(`https://open.spotify.com/track/${trackId}`, '_blank', 'noopener');
      return;
    }
    if (actionId === 'assign') {
      showAssignPopover = !showAssignPopover;
      return;
    }
    if (actionId === 'shortlist') {
      if (localSong.onShortlist) {
        await fetch(`/api/shortlist?spotify_uri=${encodeURIComponent(localSong.spotifyUri)}`, { method: 'DELETE' });
        localSong = { ...localSong, onShortlist: false };
        onupdated({ id: localSong.id, onShortlist: false });
      } else {
        await fetch('/api/shortlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spotify_uri: localSong.spotifyUri,
            title: localSong.title,
            artist: localSong.artist,
            album: localSong.album ?? undefined,
            album_art_url: localSong.albumArtUrl ?? undefined,
            year: localSong.year ?? undefined,
            duration_sec: localSong.durationSec ?? undefined,
          }),
        });
        localSong = { ...localSong, onShortlist: true };
        onupdated({ id: localSong.id, onShortlist: true });
      }
      return;
    }
    if (actionId === 'dismiss') {
      if (localSong.dismissed) {
        await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'DELETE' });
        localSong = { ...localSong, dismissed: false };
        onupdated({ id: localSong.id, dismissed: false });
      } else if (!dismissConfirm) {
        dismissConfirm = true;
        setTimeout(() => { dismissConfirm = false; }, 3000);
      } else {
        await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'POST' });
        localSong = { ...localSong, dismissed: true };
        onupdated({ id: localSong.id, dismissed: true });
        dismissConfirm = false;
      }
    }
  }
</script>

<div class="cw-songcard-wrap" class:is-dismissed={localSong.dismissed}>
  <SongCard
    song={cardSong}
    density="row"
    config={CW_CONFIG}
    expanded={open}
    onToggle={ontoggle}
    onAction={handleAction}
  />
  {#if showAssignPopover}
    <div class="cw-assign-anchor">
      <AssignPopover
        songTitle={localSong.title}
        {assignedRoundIds}
        onAssign={async (roundId) => {
          await fetch(`/api/chat/songs/${localSong.id}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ round_id: roundId }),
          });
          localSong = { ...localSong, assignedRoundIds: [...assignedRoundIds, roundId] };
        }}
        onUnassign={async (roundId) => {
          await fetch(`/api/chat/songs/${localSong.id}/assign/${roundId}`, { method: 'DELETE' });
          localSong = { ...localSong, assignedRoundIds: assignedRoundIds.filter((id: number) => id !== roundId) };
        }}
        onclose={() => showAssignPopover = false}
      />
    </div>
  {/if}
</div>

<style>
  .cw-songcard-wrap {
    position: relative;
  }
  .cw-songcard-wrap.is-dismissed {
    opacity: 0.45;
  }
  .cw-assign-anchor {
    position: absolute;
    right: 8px;
    bottom: calc(100% + 4px);
    z-index: 20;
  }
</style>
