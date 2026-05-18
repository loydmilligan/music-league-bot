<script lang="ts">
  import AssignPopover from '$lib/shortlist/AssignPopover.svelte';
  import Bookmark from '$lib/shortlist/Bookmark.svelte';
  import type { ChatSong } from './chat.js';

  const { song, open = false, ontoggle, onupdated } = $props<{
    song: ChatSong;
    open?: boolean;
    ontoggle: () => void;
    onupdated: (updated: Partial<ChatSong> & { id: string }) => void;
  }>();

  let showAssignPopover = $state(false);
  let localSong = $state({ ...song });
  let dismissConfirm = $state(false);

  const SENDER_TONE: Record<string, string> = {
    Matt: 'sky', Kieran: 'amber', Sam: 'moss', Mira: 'pulp', Davey: 'ember',
  };
  const CHAT_TONE: Record<string, string> = {
    'Hip Jammers': 'sky', 'The Lads': 'amber',
  };

  function chatTone(name: string) { return CHAT_TONE[name] ?? 'muted'; }
  function senderTone(name: string) { return SENDER_TONE[name] ?? 'muted'; }

  function humaneTime(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    const min = Math.floor(ms / 60000);
    if (min < 60) return min <= 1 ? 'just now' : `${min} min ago`;
    const h = Math.floor(ms / 3600000);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(ms / 86400000);
    if (d === 1) return '1 day ago';
    if (d < 30) return `${d} days ago`;
    return `${Math.round(d / 30)} months ago`;
  }

  function strippedMessage(raw: string): string {
    return raw.replace(/https?:\/\/\S+/g, '').trim();
  }

  async function dismiss() {
    if (!dismissConfirm) { dismissConfirm = true; setTimeout(() => dismissConfirm = false, 3000); return; }
    await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'POST' });
    onupdated({ id: localSong.id, dismissed: true });
  }

  async function undismiss() {
    await fetch(`/api/chat/songs/${localSong.id}/dismiss`, { method: 'DELETE' });
    onupdated({ id: localSong.id, dismissed: false });
  }

  const assignedRoundIds = $derived(localSong.assignedRoundIds ?? []);
</script>

{#if open}
  <!-- EXPANDED -->
  <div class="cw-row is-open">
    <div class="cw-row-open-head">
      <span class="cw-row-open-eyebrow">
        {localSong.mentionCount} {localSong.mentionCount === 1 ? 'mention' : 'mentions'} · context
      </span>
      <button type="button" class="sl-collapse-btn" onclick={ontoggle}>
        <span>↑</span><span class="sl-kbd">esc</span>
      </button>
    </div>

    <div class="cw-expanded">
      <!-- Art column -->
      <div class="cw-expanded-art">
        {#if localSong.albumArtUrl}
          <img src={localSong.albumArtUrl} alt="" width="180" height="180" style="border-radius: var(--r-2)" />
        {:else}
          <span class="sl-row-art-placeholder" style="width:180px;height:180px"></span>
        {/if}
        <div class="cw-expanded-meta">
          <div class="cw-expanded-title">{localSong.title}</div>
          <div class="cw-expanded-sub">
            {localSong.artist}{localSong.album ? ` · ${localSong.album}` : ''}
            {#if localSong.year} · {localSong.year}{/if}
          </div>
        </div>
      </div>

      <!-- Body column — context stack -->
      <div class="cw-expanded-body">
        {#if (song.mentions ?? []).length > 1}
          <div class="cw-timeline">
            {#each (song.mentions ?? []) as m, i}
              <span class="cw-timeline-pip">
                {i + 1}
                <span class="cw-chat-chip cw-chat-chip--{chatTone(m.chatName)}">{m.chatName}</span>
                <span class="cw-timeline-time">{humaneTime(m.capturedAt)}</span>
              </span>
            {/each}
          </div>
        {/if}

        {#each (song.mentions ?? []) as mention}
          <div class="cw-context-head">
            <span class="cw-chat-chip cw-chat-chip--{chatTone(mention.chatName)}">{mention.chatName}</span>
            <span class="cw-context-time">{humaneTime(mention.capturedAt)}</span>
          </div>

          <!-- Pull-quote block -->
          <div class="cw-pull">
            {#if mention.priorMessages.length > 0}
              <div class="cw-priors-eyebrow">{mention.priorMessages.length} messages before</div>
              <div class="cw-priors">
                {#each mention.priorMessages as prior}
                  <div class="cw-prior">
                    <span class="cw-prior-sender cw-prior-sender--{senderTone(prior.sender)}">{prior.sender}</span>
                    <span class="cw-prior-text">{prior.text}</span>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="cw-pull-quote">
              <span class="cw-pull-deco">"</span>
              <span class="cw-pull-text">{strippedMessage(mention.rawMessage) || mention.rawMessage}</span>
            </div>

            <div class="cw-pull-attrib">
              <span class="cw-avatar cw-avatar--{senderTone(mention.senderName)}">{mention.senderName[0]}</span>
              <span class="cw-attrib-sender cw-attrib-sender--{senderTone(mention.senderName)}">{mention.senderName}</span>
              <span class="cw-chat-chip cw-chat-chip--{chatTone(mention.chatName)}">{mention.chatName}</span>
              <span class="cw-attrib-time">{humaneTime(mention.capturedAt)}</span>
              {#if mention.intent !== 'unclassified'}
                <span class="cw-intent cw-intent--{mention.intent === 'alt' ? 'pulp' : mention.intent === 'retro' ? 'amber' : mention.intent === 'found' ? 'sky' : 'muted'}">{mention.intent.toUpperCase()}</span>
              {/if}
              <span class="cw-spotify-badge">spotify</span>
            </div>
          </div>
        {/each}
      </div>

      <!-- Actions column -->
      <div class="cw-expanded-actions">
        <a
          href="https://open.spotify.com/track/{localSong.spotifyUri.split(':').at(-1)}"
          target="_blank" rel="noopener"
          class="sl-actionbtn sl-actionbtn--spotify"
        >
          <span class="sl-actionbtn-glyph">▶</span>
          <span class="sl-actionbtn-label">Play on Spotify</span>
        </a>

        <div class="sl-popover-anchor" style="display:inline-flex">
          <button
            type="button"
            class="sl-actionbtn sl-actionbtn--assign"
            onclick={() => showAssignPopover = !showAssignPopover}
          >
            <span class="sl-actionbtn-glyph">⊕</span>
            {#if assignedRoundIds.length > 0}
              <span class="sl-actionbtn-badge">{assignedRoundIds.length}</span>
            {/if}
            <span class="sl-actionbtn-label">Assign to round</span>
          </button>
          {#if showAssignPopover}
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
          {/if}
        </div>

        <Bookmark
          spotifyUri={localSong.spotifyUri}
          title={localSong.title}
          artist={localSong.artist}
          album={localSong.album}
          albumArtUrl={localSong.albumArtUrl}
          year={localSong.year}
          durationSec={localSong.durationSec}
          onShortlist={localSong.onShortlist}
        />

        {#if localSong.dismissed}
          <button type="button" class="sl-actionbtn" onclick={undismiss}>
            <span class="sl-actionbtn-glyph">↩</span>
            <span class="sl-actionbtn-label">Restore</span>
          </button>
        {:else}
          <button
            type="button"
            class="sl-actionbtn sl-actionbtn--remove"
            onclick={dismiss}
          >
            <span class="sl-actionbtn-glyph">⊘</span>
            <span class="sl-actionbtn-label">{dismissConfirm ? 'Confirm dismiss' : 'Not interested'}</span>
          </button>
        {/if}
      </div>
    </div>
  </div>

{:else}
  <!-- COLLAPSED -->
  <div
    role="button"
    tabindex="0"
    class="cw-row"
    class:is-dismissed={localSong.dismissed}
    onclick={ontoggle}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ontoggle(); } }}
  >
    {#if localSong.albumArtUrl}
      <img src={localSong.albumArtUrl} alt="" class="sl-row-art" width="44" height="44" />
    {:else}
      <span class="sl-row-art-placeholder"></span>
    {/if}

    <span class="cw-row-text">
      <span class="cw-row-title">{localSong.title}</span>
      <span class="cw-row-artist">{localSong.artist}</span>
    </span>

    {#each localSong.chatNames as name}
      <span class="cw-chat-chip cw-chat-chip--{chatTone(name)}">{name}</span>
    {/each}

    {#if (song.mentions ?? []).length > 0}
      {@const latestIntent = (song.mentions ?? []).at(-1)?.intent}
      {#if latestIntent && latestIntent !== 'unclassified'}
        <span class="cw-intent cw-intent--{latestIntent === 'alt' ? 'pulp' : latestIntent === 'retro' ? 'amber' : latestIntent === 'found' ? 'sky' : 'muted'}">{latestIntent.toUpperCase()}</span>
      {/if}
    {/if}

    {#if localSong.mentionCount > 1}
      <span class="cw-count">{localSong.mentionCount}×</span>
    {/if}

    <span class="cw-row-time">{humaneTime(localSong.latestMentionAt)}</span>

    {#if assignedRoundIds.length > 0}
      <span class="cw-assigned-chip">→ R-{assignedRoundIds[0]}</span>
    {/if}

    <span onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation">
      <Bookmark
        spotifyUri={localSong.spotifyUri}
        title={localSong.title}
        artist={localSong.artist}
        album={localSong.album}
        albumArtUrl={localSong.albumArtUrl}
        year={localSong.year}
        durationSec={localSong.durationSec}
        onShortlist={localSong.onShortlist}
      />
    </span>

    <span onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation" style="position:relative">
      <button
        type="button"
        class="sl-iconbtn"
        onclick={() => showAssignPopover = !showAssignPopover}
      >⊕{#if assignedRoundIds.length > 0}<span class="badge">{assignedRoundIds.length}</span>{/if}</button>
      {#if showAssignPopover}
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
      {/if}
    </span>
  </div>
{/if}
