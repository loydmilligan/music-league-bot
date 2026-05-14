<script lang="ts">
  import type { PageData } from './$types.js';
  let { data } = $props<{ data: PageData }>();

  function timeUntil(iso: string | null) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'overdue';
    const h = Math.floor(ms / 3_600_000);
    return h >= 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h`;
  }
  function urgent(iso: string | null) { return iso ? new Date(iso).getTime() - Date.now() < 86_400_000 : false; }
</script>

<svelte:head><title>Music League</title></svelte:head>

<section class="mb-10">
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Active Now</h2>
  <div class="grid grid-cols-2 gap-4">
    {#each data.activeSeasons as s}
      {@const np = s.league.excludeFromCombined}
      <a href="/league/{s.league.slug}/season/{s.seasonNumber}"
        class="block rounded-xl p-4 border-2 hover:bg-slate-800 transition-colors bg-slate-800/50"
        class:border-cyan-500={!np} class:border-amber-500={np}>
        <div class="text-xs font-bold mb-1" class:text-cyan-400={!np} class:text-amber-400={np}>
          ACTIVE{np ? ' · 1 BAND/ROUND' : ''}
        </div>
        <div class="font-bold text-slate-100">{s.league.name} S{s.seasonNumber}</div>
        {#if s.currentRound}<div class="text-xs text-slate-400 mt-1 truncate">"{s.currentRound.name}"</div>{/if}
        <div class="text-xs mt-2" class:text-cyan-300={s.researchCount > 0} class:text-slate-500={!s.researchCount}>
          {s.researchCount ? `🔬 ${s.researchCount} in research` : 'No research yet'}
        </div>
        {#if s.currentRound?.submissionDeadline}
          {@const t = timeUntil(s.currentRound.submissionDeadline)}
          {#if t}<div class="text-xs mt-1 font-semibold" class:text-red-400={urgent(s.currentRound.submissionDeadline)} class:text-yellow-400={!urgent(s.currentRound.submissionDeadline)}>Submit in {t}</div>{/if}
        {/if}
        {#if s.currentRound?.votingDeadline}
          {@const t = timeUntil(s.currentRound.votingDeadline)}
          {#if t}<div class="text-xs mt-1 font-semibold" class:text-red-400={urgent(s.currentRound.votingDeadline)} class:text-yellow-400={!urgent(s.currentRound.votingDeadline)}>Vote in {t}</div>{/if}
        {/if}
      </a>
    {/each}
  </div>
</section>

{#if data.pastLeagues.length}
<section class="mb-10">
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Past Seasons</h2>
  <div class="flex flex-col gap-2">
    {#each data.pastLeagues as item}
      <a href="/league/{item.league.slug}/season/{item.seasons.at(-1)?.seasonNumber ?? 1}"
        class="flex items-center rounded-lg px-4 py-3 border border-slate-700 hover:bg-slate-800 bg-slate-800/50 transition-colors">
        <span class="font-semibold text-slate-300">{item.league.name}</span>
        <span class="text-slate-500 text-xs ml-auto">{item.totalRounds} rounds · {item.totalSongs} songs →</span>
      </a>
    {/each}
  </div>
</section>
{/if}

<section>
  <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">
    All Songs Ever
    <span class="text-slate-600 normal-case font-normal ml-2">{data.mlSongs.length + data.chatMentions.length} tracks</span>
  </h2>
  <div class="flex gap-3 mb-3 text-xs">
    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> ML submission</span>
    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-green-400 inline-block"></span> Chat mention</span>
  </div>
  <div class="flex flex-col gap-1 max-h-96 overflow-y-auto">
    {#each data.mlSongs as s}
      <div class="flex items-center gap-2 px-3 py-2 rounded bg-slate-800/50 text-sm">
        <span class="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0"></span>
        <span class="text-slate-200 flex-1 truncate">{s.title} — {s.artists}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{s.league_name} S{s.season_number}</span>
      </div>
    {/each}
    {#each data.chatMentions as m}
      <div class="flex items-center gap-2 px-3 py-2 rounded bg-slate-800/50 text-sm">
        <span class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
        <span class="text-slate-200 flex-1 truncate">{m.trackTitle ?? 'Unknown'} — {m.trackArtist ?? ''}</span>
        <span class="text-slate-500 text-xs flex-shrink-0">{new Date(m.createdAt).toLocaleDateString()}</span>
      </div>
    {/each}
  </div>
</section>
