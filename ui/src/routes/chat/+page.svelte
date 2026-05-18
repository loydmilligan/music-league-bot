<script lang="ts">
  import '$lib/chat/chat.css';
  import CwFilterBar from '$lib/chat/CwFilterBar.svelte';
  import CwRow from '$lib/chat/CwRow.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PageData } from './$types.js';
  import type { ChatSong } from '$lib/chat/chat.js';

  const { data } = $props<{ data: PageData }>();

  let songs = $state<ChatSong[]>(data.songs);
  let openId = $state<string | null>(null);

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === 'all' || v === 'recent') params.delete(k);
      else params.set(k, v);
    }
    goto(`?${params.toString()}`, { replaceState: true, keepFocus: true });
  }

  function handleUpdated(patch: Partial<ChatSong> & { id: string }) {
    songs = songs.map(s => s.id === patch.id ? { ...s, ...patch } : s);
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape') openId = null;
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="cw-main">
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /chat</p>
    <h1 class="font-display text-3xl font-bold text-fg">Chat watcher</h1>
    <p class="text-fg-muted text-sm mt-1">Songs that came up in your WhatsApp chats. Rate, assign, or shortlist.</p>
  </header>

  <CwFilterBar
    total={data.totalCount}
    unassignedCount={data.unassignedCount}
    assignedCount={data.assignedCount}
    chatNames={data.chatNames}
    status={data.status}
    activeChatName={data.chatName}
    sort={data.sort}
    onStatusChange={(s) => updateParams({ status: s })}
    onChatChange={(n) => updateParams({ chat: n })}
    onSortChange={(s) => updateParams({ sort: s })}
  />

  <div class="sl-rows mt-4">
    {#each songs as song (song.id)}
      <CwRow
        {song}
        open={openId === song.id}
        ontoggle={() => openId = openId === song.id ? null : song.id}
        onupdated={handleUpdated}
      />
    {/each}
    {#if songs.length === 0}
      <p class="font-mono text-sm text-fg-faint italic mt-8 text-center">
        No songs yet — they appear here when group members share music links in chat.
      </p>
    {/if}
  </div>
</div>
