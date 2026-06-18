<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';

  let { data } = $props<{ data: PageData }>();

  // Debug mode toggle — fetches current state on mount, PUTs on change
  let debugEnabled = $state(false);
  let debugLoading = $state(false);

  async function loadDebugMode() {
    try {
      const r = await fetch('/api/settings/debug-mode');
      if (r.ok) {
        const body = await r.json() as { enabled: boolean };
        debugEnabled = body.enabled;
      }
    } catch {
      // silently ignore — toggle stays false
    }
  }

  async function toggleDebugMode() {
    debugLoading = true;
    try {
      const r = await fetch('/api/settings/debug-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: debugEnabled }),
      });
      if (r.ok) {
        const body = await r.json() as { enabled: boolean };
        debugEnabled = body.enabled;
      }
    } catch {
      // rollback on error
      debugEnabled = !debugEnabled;
    } finally {
      debugLoading = false;
    }
  }

  // Load on mount
  $effect(() => {
    loadDebugMode();
  });

  let w = $state({ ...data.settings });
  let wTotal = $derived(
    w.weightDiscovery + w.weightThemeFit + w.weightPersonal + w.weightNostalgia
  );
  const totalOk = $derived(Math.abs(wTotal - 100) <= 1);

  function resetWeights() {
    w = { weightDiscovery: 35, weightThemeFit: 25, weightPersonal: 25, weightNostalgia: 15 };
  }

  // Last successful import for the import-card header chip.
  const lastSuccess = $derived(
    data.importLog.find((e: { status: string }) => e.status === 'success') ?? null
  );
  const hasFailedImport = $derived(
    data.importLog.some((e: { status: string }) => e.status === 'error')
  );

  // Queue status derivation. The loader doesn't surface worker-running state,
  // so we infer a visual from what we have: any failures → warn; pending in
  // flight → accent ("DRAINING"); otherwise health ("IDLE").
  const queueTone = $derived(
    data.queueStatus.failures.length > 0
      ? 'warn'
      : data.queueStatus.pending > 0
        ? 'accent'
        : 'health'
  );
  const queueLabel = $derived(
    data.queueStatus.failures.length > 0
      ? `${data.queueStatus.failures.length} FAILURE${data.queueStatus.failures.length === 1 ? '' : 'S'}`
      : data.queueStatus.pending > 0
        ? `DRAINING · ${data.queueStatus.pending} PENDING`
        : 'IDLE'
  );

  type WeightField = 'weightDiscovery' | 'weightThemeFit' | 'weightPersonal' | 'weightNostalgia';
  const weightFields: Array<{ field: WeightField; label: string; dot: string; tooltip: string }> = [
    {
      field: 'weightDiscovery',
      label: 'Discovery potential',
      dot: 'bg-health',
      tooltip: 'Likelihood this is new to the league — niche or underrated.'
    },
    {
      field: 'weightThemeFit',
      label: 'Theme fit',
      dot: 'bg-accent',
      tooltip: "How well the song matches the round's stated theme."
    },
    {
      field: 'weightPersonal',
      label: 'Personal rating',
      dot: 'bg-warn',
      tooltip: 'Your gut-level affection independent of theme.'
    },
    {
      field: 'weightNostalgia',
      label: 'Nostalgia potential',
      dot: 'bg-accent-strong',
      tooltip: 'Emotional / personal connection from the past.'
    }
  ];
  const weightFieldKeys: WeightField[] = weightFields.map((f) => f.field);

  // Auto-balance: when on, moving one slider by Δ distributes −Δ/3 across the other
  // three (clamped to [0,100]). Implemented via explicit oninput (not bind:value) so
  // we control the mutation in one synchronous batch — no reactive cycle.
  let autoBalance = $state(false);

  function clampWeight(n: number): number {
    return Math.max(0, Math.min(100, n));
  }

  function handleWeightInput(field: WeightField, raw: number) {
    const newValue = clampWeight(Math.round(raw));
    if (!autoBalance) {
      w = { ...w, [field]: newValue };
      return;
    }
    const delta = newValue - w[field];
    const share = delta / 3;
    const next = { ...w, [field]: newValue } as Record<WeightField, number>;
    for (const other of weightFieldKeys) {
      if (other === field) continue;
      next[other] = Math.round(clampWeight(w[other] - share));
    }
    w = next;
  }
</script>

<svelte:head><title>App Settings · music-league-bot</title></svelte:head>

<!-- Page header / breadcrumb -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · /settings
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">App Settings</h1>
  <p class="text-fg-muted max-w-2xl">
    Rating weights, import controls, and queue diagnostics.
  </p>
  <nav class="mt-4 flex flex-wrap gap-3 text-xs font-mono tracking-widest uppercase">
    <a
      href="/settings/api-tokens"
      class="text-accent hover:text-accent-strong underline decoration-dotted underline-offset-4 transition-colors"
    >
      → API tokens (extension auth)
    </a>
  </nav>
</div>

<SettingsTabs />

<!-- Two-column layout at md+: weights (left) | import + queue (right). -->
<div class="grid md:grid-cols-2 gap-6 mb-6 items-start mt-6">
<!-- Section 1: Rating Weights (left column) -->
<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="mb-1">
    <SectionLabel>Research weights</SectionLabel>
    <h2 class="text-lg font-bold text-fg mt-1">Rating weights</h2>
  </header>
  <p class="text-xs text-fg-dim mb-4">
    Four dimensions, sums to 100. The weighted score is
    <code class="font-mono text-fg">Σ(rating × weight) / Σ(weight)</code>.
  </p>

  <!-- Auto-balance toggle + live sum indicator -->
  <div class="flex items-center justify-between gap-3 mb-5">
    <label
      class="inline-flex items-center gap-2 cursor-pointer select-none"
      title="When on, moving any slider redistributes −Δ/3 across the other three."
    >
      <input
        type="checkbox"
        bind:checked={autoBalance}
        class="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
      />
      <span class="font-mono text-[11px] tracking-widest uppercase text-fg-muted">
        Auto-balance
      </span>
    </label>
    {#if totalOk}
      <StatusChip label="SUMS TO 100" tone="accent" />
    {:else}
      <StatusChip label="SUM: {wTotal}" tone="warn" />
    {/if}
  </div>

  <form method="POST" action="?/updateWeights" use:enhance class="space-y-4">
    {#each weightFields as { field, label, dot, tooltip } (field)}
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 w-52">
          <span class="w-2 h-2 rounded-full {dot} shrink-0"></span>
          <label
            class="text-sm text-fg-muted cursor-help underline decoration-dotted decoration-fg-faint underline-offset-4"
            for="w-{field}"
            title={tooltip}
          >
            {label}
          </label>
        </div>
        <input
          id="w-{field}"
          type="range"
          name={field}
          min="0"
          max="100"
          value={w[field]}
          oninput={(e) => handleWeightInput(field, Number(e.currentTarget.value))}
          class="flex-1 accent-[var(--color-accent)]"
        />
        <span class="w-12 text-right text-sm font-mono text-fg">
          {w[field]}%
        </span>
      </div>
    {/each}

    <!-- Visual proportion bar -->
    <div class="flex h-2 rounded-sm overflow-hidden border border-border-muted">
      <div class="bg-health transition-all" style="width:{w.weightDiscovery}%"></div>
      <div class="bg-accent transition-all" style="width:{w.weightThemeFit}%"></div>
      <div class="bg-warn transition-all" style="width:{w.weightPersonal}%"></div>
      <div class="bg-accent-strong transition-all" style="width:{w.weightNostalgia}%"></div>
    </div>

    <div class="flex items-center gap-4 pt-2">
      <button
        type="button"
        onclick={resetWeights}
        class="font-mono text-[11px] tracking-widest uppercase text-fg-dim hover:text-fg transition-colors"
      >
        Reset defaults
      </button>
      <button
        type="submit"
        class="ml-auto bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
      >
        Save weights
      </button>
    </div>
  </form>
</section>

<!-- Right column: Import + Queue stacked -->
<div class="flex flex-col gap-6">
<!-- Section 2: ZIP Import -->
<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
    <div>
      <SectionLabel>Import</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">ZIP import &amp; rescan</h2>
    </div>
    {#if hasFailedImport}
      <StatusChip label="LAST IMPORT FAILED" tone="warn" />
    {:else if lastSuccess}
      <StatusChip
        label="LAST · {new Date(lastSuccess.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}"
        tone="health"
      />
    {:else}
      <StatusChip label="NO IMPORTS" tone="muted" />
    {/if}
  </header>
  <p class="text-xs text-fg-dim mb-5">
    Drop a Music League <code class="font-mono text-fg">export.zip</code> or rescan
    <code class="font-mono text-fg">data/&lt;league&gt;/season-N/</code> on disk.
  </p>

  <div class="flex flex-wrap gap-3 items-end mb-5">
    <form
      method="POST"
      action="?/importZip"
      use:enhance
      enctype="multipart/form-data"
      class="flex flex-wrap gap-3 items-end"
    >
      <div>
        <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="imp-league">League</label>
        <select
          id="imp-league"
          name="league"
          class="bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors"
        >
          {#each data.allLeagues as l (l.slug)}<option value={l.slug}>{l.name}</option>{/each}
        </select>
      </div>
      <div>
        <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="imp-season">Season</label>
        <input
          id="imp-season"
          type="number"
          name="season"
          min="1"
          value="1"
          class="w-20 bg-bg-elevated border border-border-muted rounded-md px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none transition-colors"
        />
      </div>
      <div>
        <label class="block font-mono text-[11px] tracking-widest uppercase text-fg-faint mb-1.5" for="imp-zip">export.zip</label>
        <input
          id="imp-zip"
          type="file"
          name="zip"
          accept=".zip"
          class="text-sm text-fg-muted file:bg-surface-strong file:text-fg file:border-0 file:rounded-md file:px-3 file:py-1.5 file:mr-3 file:font-mono file:text-[11px] file:tracking-widest file:uppercase file:cursor-pointer hover:file:bg-border"
        />
      </div>
      <button
        type="submit"
        class="bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md transition-colors"
      >
        Import
      </button>
    </form>
    <form method="POST" action="?/rescan" use:enhance>
      <button
        type="submit"
        class="border border-border text-fg-muted hover:text-fg hover:border-accent font-mono text-xs tracking-widest uppercase px-4 py-2 rounded-md transition-colors"
      >
        Re-scan disk
      </button>
    </form>
  </div>

  {#if data.importLog.length}
    <div class="overflow-x-auto border-t border-border-muted -mx-6 px-6 pt-4">
      <table class="w-full text-xs">
        <thead>
          <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">
            <th class="text-left py-1.5 pr-4 font-bold">League</th>
            <th class="text-left py-1.5 pr-4 font-bold">Season</th>
            <th class="text-left py-1.5 pr-4 font-bold">Imported</th>
            <th class="text-left py-1.5 pr-4 font-bold">Rounds</th>
            <th class="text-left py-1.5 pr-4 font-bold">Songs</th>
            <th class="text-left py-1.5 font-bold">Status</th>
          </tr>
        </thead>
        <tbody class="text-fg-muted">
          {#each data.importLog as entry (entry.id ?? `${entry.leagueSlug}-${entry.seasonNumber}-${entry.importedAt}`)}
            <tr class="border-t border-border-muted hover:bg-surface-hover">
              <td class="py-1.5 pr-4 text-fg">{entry.leagueSlug}</td>
              <td class="py-1.5 pr-4 font-mono">S{entry.seasonNumber}</td>
              <td class="py-1.5 pr-4 font-mono text-fg-dim">{new Date(entry.importedAt).toLocaleString()}</td>
              <td class="py-1.5 pr-4 font-mono">{entry.roundsCount}</td>
              <td class="py-1.5 pr-4 font-mono">{entry.submissionsCount}</td>
              <td class="py-1.5">
                {#if entry.status === 'success'}
                  <StatusChip label="OK" tone="health" />
                {:else if entry.status === 'error'}
                  <StatusChip label="ERROR" tone="warn" />
                {:else if entry.status === 'partial'}
                  <StatusChip label="PARTIAL" tone="warn" />
                {:else}
                  <StatusChip label={entry.status} tone="muted" />
                {/if}
                {#if entry.error}
                  <span class="ml-2 text-fg-dim">— {entry.error}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-fg-dim text-sm">No imports yet.</p>
  {/if}
</section>

<!-- Section 3: Songlink Queue (right column, below Import) -->
<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
    <div>
      <SectionLabel>Queue</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">Songlink resolution queue</h2>
    </div>
    <StatusChip label={queueLabel} tone={queueTone} />
  </header>
  <p class="text-xs text-fg-dim mb-5">
    Background worker resolves Spotify URIs to YouTube Music links via Songlink, capped at 10/min.
  </p>

  <div class="grid grid-cols-3 gap-3 mb-5">
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Pending</SectionLabel>
      <div class="text-3xl font-display font-bold text-warn mt-1 leading-none">
        {data.queueStatus.pending}
      </div>
      {#if data.queueStatus.pending > 0}
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
          ~{data.queueStatus.estimatedMinutes}m @ 10/min
        </div>
      {:else}
        <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">drained</div>
      {/if}
    </div>
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Resolved 24h</SectionLabel>
      <div class="text-3xl font-display font-bold text-health mt-1 leading-none">
        {data.queueStatus.done24h}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">last 24h</div>
    </div>
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Failures</SectionLabel>
      <div
        class="text-3xl font-display font-bold mt-1 leading-none {data.queueStatus.failures.length > 0 ? 'text-accent' : 'text-fg-faint'}"
      >
        {data.queueStatus.failures.length}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
        {data.queueStatus.failures.length > 0 ? 'needs retry' : 'clean'}
      </div>
    </div>
  </div>

  {#if data.queueStatus.failures.length}
    <div class="overflow-x-auto border-t border-border-muted -mx-6 px-6 pt-4">
      <table class="w-full text-xs">
        <thead>
          <tr class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">
            <th class="text-left py-1.5 pr-4 font-bold">Track</th>
            <th class="text-left py-1.5 pr-4 font-bold">Error</th>
            <th class="py-1.5"></th>
          </tr>
        </thead>
        <tbody class="text-fg-muted">
          {#each data.queueStatus.failures as f (f.id)}
            <tr class="border-t border-border-muted">
              <td class="py-1.5 pr-4 text-fg">{f.title ?? f.spotify_uri}</td>
              <td class="py-1.5 pr-4 text-warn">{f.error ?? 'No YTM link found'}</td>
              <td class="py-1.5 text-right">
                <form method="POST" action="?/retryYtm" use:enhance>
                  <input type="hidden" name="id" value={f.id} />
                  <button
                    type="submit"
                    class="font-mono text-[10px] tracking-widest uppercase text-accent hover:text-accent-strong transition-colors"
                  >
                    Retry
                  </button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
</div><!-- /right column -->
</div><!-- /two-column grid -->

<!-- Debug mode toggle card -->
<section class="bg-surface border border-border-muted rounded-xl p-6 mt-6">
  <header class="flex items-center justify-between gap-3 mb-1 flex-wrap">
    <div>
      <SectionLabel>Developer</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">Debug mode</h2>
    </div>
    {#if debugEnabled}
      <StatusChip label="ENABLED" tone="warn" />
    {:else}
      <StatusChip label="OFF" tone="muted" />
    {/if}
  </header>
  <p class="text-xs text-fg-dim mb-5">
    Enables the <a href="/settings/debug" class="text-accent hover:text-accent-strong underline decoration-dotted underline-offset-4 transition-colors">Debug tab</a>
    with a live cost dashboard — today's LLM spend by category, call drilldown, 14-day stacked bar chart, and model value rankings.
  </p>
  <label class="inline-flex items-center gap-3 cursor-pointer select-none">
    <input
      type="checkbox"
      bind:checked={debugEnabled}
      onchange={toggleDebugMode}
      disabled={debugLoading}
      class="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
    />
    <span class="font-mono text-[11px] tracking-widest uppercase text-fg-muted">
      {debugEnabled ? 'Debug mode on — visit /settings/debug' : 'Enable debug mode'}
    </span>
  </label>
</section>
