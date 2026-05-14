<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  let { data } = $props<{ data: PageData }>();

  let w = $state({ ...data.settings });
  let wTotal = $derived(w.weightDiscovery + w.weightThemeFit + w.weightPersonal + w.weightNostalgia);

  function resetWeights() {
    w = { weightDiscovery: 35, weightThemeFit: 25, weightPersonal: 25, weightNostalgia: 15 };
  }
</script>

<svelte:head><title>Settings</title></svelte:head>
<h1 class="text-2xl font-bold mb-8">Settings</h1>

<!-- Section 1: Rating Weights -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-1">Research Rating Weights</h2>
  <p class="text-xs text-slate-400 mb-4">Must sum to 100. Discovery is weighted highest by default.</p>
  <form method="POST" action="?/updateWeights" use:enhance class="space-y-4">
    {#each [
      ['weightDiscovery', 'Discovery Potential ⭐', 'text-green-400'],
      ['weightThemeFit',  'Theme Fit',              'text-blue-400'],
      ['weightPersonal',  'Personal Rating',         'text-purple-400'],
      ['weightNostalgia', 'Nostalgia Potential',     'text-orange-400'],
    ] as [field, label, color]}
      <div class="flex items-center gap-4">
        <label class="w-44 text-sm {color}">{label}</label>
        <input type="range" name={field} min="0" max="100"
          bind:value={(w as any)[field]}
          class="flex-1 accent-purple-500" />
        <span class="w-10 text-right text-sm font-mono text-slate-300">{(w as any)[field]}%</span>
      </div>
    {/each}
    <!-- Visual proportion bar -->
    <div class="flex h-2 rounded overflow-hidden mt-2">
      <div class="bg-green-500 transition-all" style="width:{w.weightDiscovery}%"></div>
      <div class="bg-blue-500 transition-all" style="width:{w.weightThemeFit}%"></div>
      <div class="bg-purple-500 transition-all" style="width:{w.weightPersonal}%"></div>
      <div class="bg-orange-500 transition-all" style="width:{w.weightNostalgia}%"></div>
    </div>
    <div class="flex items-center gap-4 mt-2">
      <span class="text-xs" class:text-red-400={Math.abs(wTotal-100)>1} class:text-green-400={Math.abs(wTotal-100)<=1}>
        Total: {wTotal}%
      </span>
      <button type="button" onclick={resetWeights} class="text-xs text-slate-400 hover:text-slate-200">Reset to defaults</button>
      <button type="submit" class="ml-auto bg-purple-700 hover:bg-purple-600 text-white px-4 py-1.5 rounded text-sm">Save</button>
    </div>
  </form>
</section>

<!-- Section 2: ZIP Import -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-4">ZIP Import</h2>
  <div class="flex flex-wrap gap-3 items-end mb-4">
    <form method="POST" action="?/importZip" use:enhance enctype="multipart/form-data" class="flex flex-wrap gap-3 items-end">
      <div>
        <label class="block text-xs text-slate-400 mb-1">League</label>
        <select name="league" class="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100">
          {#each data.allLeagues as l}<option value={l.slug}>{l.name}</option>{/each}
        </select>
      </div>
      <div>
        <label class="block text-xs text-slate-400 mb-1">Season #</label>
        <input type="number" name="season" min="1" value="1" class="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100" />
      </div>
      <div>
        <label class="block text-xs text-slate-400 mb-1">export.zip</label>
        <input type="file" name="zip" accept=".zip" class="text-sm text-slate-300" />
      </div>
      <button type="submit" class="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm">Import</button>
    </form>
    <form method="POST" action="?/rescan" use:enhance>
      <button type="submit" class="bg-slate-600 hover:bg-slate-500 text-white px-4 py-1.5 rounded text-sm">Re-scan disk</button>
    </form>
  </div>
  {#if data.importLog.length}
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-slate-400">
        <thead><tr class="border-b border-slate-700">
          <th class="text-left py-1 pr-4">League</th><th class="text-left py-1 pr-4">Season</th>
          <th class="text-left py-1 pr-4">Imported</th><th class="text-left py-1 pr-4">Rounds</th>
          <th class="text-left py-1 pr-4">Songs</th><th class="text-left py-1">Status</th>
        </tr></thead>
        <tbody>
          {#each data.importLog as entry}
            <tr class="border-b border-slate-800 hover:bg-slate-800/30">
              <td class="py-1 pr-4">{entry.leagueSlug}</td>
              <td class="py-1 pr-4">S{entry.seasonNumber}</td>
              <td class="py-1 pr-4">{new Date(entry.importedAt).toLocaleString()}</td>
              <td class="py-1 pr-4">{entry.roundsCount}</td>
              <td class="py-1 pr-4">{entry.submissionsCount}</td>
              <td class="py-1" class:text-green-400={entry.status==='success'} class:text-red-400={entry.status==='error'} class:text-yellow-400={entry.status==='partial'}>
                {entry.status}{entry.error ? ` — ${entry.error}` : ''}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-slate-500 text-sm">No imports yet.</p>
  {/if}
</section>

<!-- Section 3: Round Deadlines -->
<section class="mb-10 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-1">Round Deadlines</h2>
  <p class="text-xs text-slate-400 mb-4">Set submission and voting deadlines for active rounds. Shown as countdowns on the home screen.</p>
  {#if data.activeRounds.length}
    <div class="flex flex-col gap-3">
      {#each data.activeRounds as r}
        <form method="POST" action="?/updateDeadline" use:enhance class="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="roundId" value={r.id} />
          <span class="text-slate-300 w-48 truncate">{r.leagueName} S{r.seasonNumber} — {r.name}</span>
          <div class="flex items-center gap-2">
            <label class="text-xs text-yellow-400">Submit by</label>
            <input type="datetime-local" name="submissionDeadline" value={r.submissionDeadline?.slice(0,16) ?? ''}
              class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-xs text-cyan-400">Vote by</label>
            <input type="datetime-local" name="votingDeadline" value={r.votingDeadline?.slice(0,16) ?? ''}
              class="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200" />
          </div>
          <button type="submit" class="bg-slate-600 hover:bg-slate-500 text-white px-3 py-1 rounded text-xs">Save</button>
        </form>
      {/each}
    </div>
  {:else}
    <p class="text-slate-500 text-sm">No active rounds found.</p>
  {/if}
</section>

<!-- Section 4: Songlink Queue -->
<section class="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
  <h2 class="font-bold text-slate-100 mb-4">Songlink Resolution Queue</h2>
  <div class="grid grid-cols-3 gap-4 mb-4 text-center">
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-yellow-400">{data.queueStatus.pending}</div>
      <div class="text-xs text-slate-400">Pending</div>
      {#if data.queueStatus.pending > 0}
        <div class="text-xs text-slate-500 mt-1">~{data.queueStatus.estimatedMinutes}m at 10/min</div>
      {/if}
    </div>
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-green-400">{data.queueStatus.done24h}</div>
      <div class="text-xs text-slate-400">Resolved (24h)</div>
    </div>
    <div class="bg-slate-900 rounded-lg p-3">
      <div class="text-2xl font-bold text-red-400">{data.queueStatus.failures.length}</div>
      <div class="text-xs text-slate-400">Failures</div>
    </div>
  </div>
  {#if data.queueStatus.failures.length}
    <div class="overflow-x-auto">
      <table class="w-full text-xs text-slate-400">
        <thead><tr class="border-b border-slate-700"><th class="text-left py-1 pr-4">Track</th><th class="text-left py-1 pr-4">Error</th><th class="py-1"></th></tr></thead>
        <tbody>
          {#each data.queueStatus.failures as f}
            <tr class="border-b border-slate-800">
              <td class="py-1 pr-4">{f.title ?? f.spotify_uri}</td>
              <td class="py-1 pr-4 text-red-400">{f.error ?? 'No YTM link found'}</td>
              <td class="py-1">
                <form method="POST" action="?/retryYtm" use:enhance>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" class="text-blue-400 hover:text-blue-300">Retry</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
