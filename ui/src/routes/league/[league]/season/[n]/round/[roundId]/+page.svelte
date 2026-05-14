<script lang="ts">
  import type { PageData } from './$types.js';
  import ResearchList from '$lib/components/ResearchList.svelte';
  let { data } = $props<{ data: PageData }>();
  let tab = $state<'ml' | 'chat' | 'research'>('ml');
  let ytmMode = $state(false);
</script>

<svelte:head><title>{data.round.name}</title></svelte:head>

<div class="text-sm text-slate-400 mb-4">
  <a href="/" class="hover:text-purple-400">Home</a> ›
  <a href="/league/{data.league.slug}/season/{data.season.seasonNumber}" class="hover:text-purple-400">{data.league.name} S{data.season.seasonNumber}</a> ›
  {data.round.name}
</div>

<div class="mb-6">
  <h1 class="text-2xl font-bold text-slate-100">{data.round.name}</h1>
  {#if data.round.description}<p class="text-slate-400 mt-1">{data.round.description}</p>{/if}
</div>

<div class="flex gap-1 mb-6 bg-slate-900 rounded-lg p-1 w-fit">
  {#each [['ml','ML Playlist'],['chat','Chat Mentions'],['research','🔬 Research']] as [key, label]}
    <button onclick={() => tab = key as any}
      class="px-4 py-1.5 rounded text-sm font-medium transition-colors"
      class:bg-purple-600={tab===key} class:text-white={tab===key}
      class:text-slate-400={tab!==key} class:hover:text-slate-200={tab!==key}>
      {label}
    </button>
  {/each}
</div>

{#if tab === 'ml'}
  <div class="flex items-center gap-4 mb-4">
    {#if data.round.spotifyPlaylistUrl}
      <a href={data.round.spotifyPlaylistUrl} target="_blank" class="text-green-400 text-sm hover:underline">Open in Spotify ↗</a>
    {/if}
    <div class="flex items-center gap-1 bg-slate-800 rounded-full px-1 py-1 text-xs ml-auto">
      <button onclick={() => ytmMode = false}
        class="px-3 py-0.5 rounded-full transition-colors"
        class:bg-green-500={!ytmMode} class:text-black={!ytmMode} class:font-bold={!ytmMode} class:text-slate-400={ytmMode}>
        Spotify
      </button>
      <button onclick={() => ytmMode = true}
        class="px-3 py-0.5 rounded-full transition-colors"
        class:bg-red-500={ytmMode} class:text-white={ytmMode} class:font-bold={ytmMode} class:text-slate-400={!ytmMode}>
        YT Music
      </button>
    </div>
  </div>
  <div class="flex flex-col gap-2">
    {#each data.mlSubmissions as s}
      <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700">
        <span class="text-slate-500 text-xs w-5 text-right flex-shrink-0">#{s.rank}</span>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-100 truncate">{s.title}</div>
          <div class="text-xs text-slate-400">{s.artists}{s.submitterName ? ` · ${s.submitterName}` : ''}</div>
        </div>
        {#if ytmMode}
          <a href="/api/ytm/{encodeURIComponent(s.spotifyUri)}?redirect=1" target="_blank"
            class="text-xs text-red-400 hover:underline flex-shrink-0">YT Music ↗</a>
        {:else}
          <span class="text-amber-400 font-bold text-sm flex-shrink-0">{s.totalPoints} pts</span>
        {/if}
      </div>
    {/each}
    {#if !data.mlSubmissions.length}<p class="text-slate-500">No submissions imported yet.</p>{/if}
  </div>
{/if}

{#if tab === 'chat'}
  <div class="flex flex-col gap-2">
    {#each data.chatMentions as m}
      <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700">
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-100 truncate">{m.trackTitle ?? 'Unknown'}</div>
          <div class="text-xs text-slate-400">{m.trackArtist ?? ''} · {m.submitterName}</div>
        </div>
        <span class="text-green-400 text-xs flex-shrink-0">{m.sourcePlatform ?? 'chat'}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{new Date(m.createdAt).toLocaleDateString()}</span>
      </div>
    {/each}
    {#if !data.chatMentions.length}<p class="text-slate-500">No chat mentions found for this round's time window.</p>{/if}
  </div>
{/if}

{#if tab === 'research'}
  <ResearchList roundId={data.round.id} initial={data.research} weights={data.settings} />
{/if}
