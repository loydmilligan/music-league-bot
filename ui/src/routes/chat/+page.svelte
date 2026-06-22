<script lang="ts">
  import '$lib/chat/chat.css';
  import CwFilterBar from '$lib/chat/CwFilterBar.svelte';
  import CwRow from '$lib/chat/CwRow.svelte';
  import HistoryView from '$lib/chat/history/HistoryView.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PageData } from './$types.js';
  import type { ChatSong } from '$lib/chat/chat.js';

  const { data } = $props<{ data: PageData }>();

  let songs = $state<ChatSong[]>(data.songs);
  let openId = $state<string | null>(null);

  // Tab state — default to History
  let tab = $state<'history' | 'songs'>('history');

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

<div>
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /chat</p>
    <h1 class="font-display text-3xl font-bold text-fg">Chat Content</h1>
    <p class="text-fg-muted text-sm mt-1">
      Everything said in your league chats. Read any round's full thread, or search across every message.
    </p>
  </header>

  <!-- Tab strip -->
  <div class="border-b border-border-muted mb-6">
    <div class="flex gap-6">
      {#each ([
        { key: 'history', label: 'History', count: data.totalMessageCount },
        { key: 'songs',   label: 'Songs',   count: data.totalCount },
      ] as const) as t}
        <button
          type="button"
          onclick={() => (tab = t.key)}
          class="font-mono text-sm uppercase tracking-wider py-3 -mb-px border-b-2 transition-colors flex items-center gap-2"
          class:border-accent={tab === t.key}
          class:text-accent={tab === t.key}
          class:font-bold={tab === t.key}
          class:border-transparent={tab !== t.key}
          class:text-fg-muted={tab !== t.key}
          class:hover:text-fg={tab !== t.key}
        >
          <span>{t.label}</span>
          {#if t.count > 0}
            <span class="font-mono text-[10px] text-fg-faint">[{t.count}]</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  {#if tab === 'history'}
    <HistoryView
      rounds={data.historyRounds}
      groups={data.chatGroups}
      senders={data.allSenders}
      sendersByGroup={data.sendersByGroup}
      selfNames={data.selfNames}
    />
  {:else}
    <div class="cw-main">
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
  {/if}
</div>
