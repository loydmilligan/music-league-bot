<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';

  let { data } = $props<{ data: PageData }>();

  // Auto-analyze audio toggle
  let autoAnalyzeEnabled = $state(false);
  let autoAnalyzeLoading = $state(false);

  async function loadAutoAnalyze() {
    try {
      const r = await fetch('/api/settings/auto-analyze');
      if (r.ok) {
        const body = await r.json() as { enabled: boolean };
        autoAnalyzeEnabled = body.enabled;
      }
    } catch { /* silently ignore */ }
  }

  async function toggleAutoAnalyze() {
    autoAnalyzeLoading = true;
    try {
      const r = await fetch('/api/settings/auto-analyze', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: autoAnalyzeEnabled }),
      });
      if (r.ok) {
        const body = await r.json() as { enabled: boolean };
        autoAnalyzeEnabled = body.enabled;
      }
    } catch {
      autoAnalyzeEnabled = !autoAnalyzeEnabled;
    } finally {
      autoAnalyzeLoading = false;
    }
  }

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

  // ---------------------------------------------------------------------------
  // Metadata queue panel
  // ---------------------------------------------------------------------------

  interface JobCounts {
    pending: number;
    processing: number;
    done24h: number;
    failed: number;
    total: number;
  }
  interface ReadinessItem { ok: boolean; count: number; total: number; }
  interface DigestReadiness {
    ytm: ReadinessItem; lastfm_pop: ReadinessItem; lastfm_tags: ReadinessItem;
    lyrics: ReadinessItem; audio: ReadinessItem;
  }
  interface CoverageRow {
    spotify_uri: string; title: string | null; artist: string | null;
    jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'>;
  }
  interface QueueStatusPayload {
    byJobType: Record<string, JobCounts>;
    failures: Array<{ id: number; spotify_uri: string; job_type: string; error: string | null; retries: number }>;
    totalPending: number;
    totalProcessing: number;
    digestReadiness?: DigestReadiness;
    coverageMatrix?: CoverageRow[];
  }

  const JOB_META: Record<string, { name: string; provider: string; speed: string }> = {
    ytm:         { name: 'YTM playlist links',    provider: 'Songlink', speed: 'fast' },
    lastfm_pop:  { name: 'Tastemaker popularity', provider: 'Last.fm',  speed: 'fast' },
    lastfm_tags: { name: 'Genre & mood tags',     provider: 'Last.fm',  speed: 'fast' },
    lyrics:      { name: 'Lyrical metrics',       provider: 'LRCLIB',   speed: 'fast' },
    audio:       { name: 'Audio insights',        provider: 'sintel',   speed: '2–10m · 1 concurrent' },
  };
  const JOB_ORDER = ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'audio'] as const;

  let selectedScope = $state<number | null>(null);
  let queueData = $state<QueueStatusPayload | null>(null);

  $effect(() => {
    const scope = selectedScope;
    async function doFetch() {
      const url = scope != null
        ? `/api/metadata-queue/status?roundId=${scope}`
        : '/api/metadata-queue/status';
      try {
        const r = await fetch(url);
        if (r.ok) queueData = (await r.json()) as QueueStatusPayload;
      } catch { /* silently ignore */ }
    }
    doFetch();
    const interval = setInterval(doFetch, 10000);
    return () => clearInterval(interval);
  });

  function jobDone(c: JobCounts): number {
    return Math.max(0, c.total - c.pending - c.processing - c.failed);
  }
  function jobProgress(c: JobCounts): number {
    return c.total === 0 ? 0 : jobDone(c) / c.total;
  }
  function jobChipTone(c: JobCounts): 'health' | 'accent' | 'warn' | 'muted' {
    if (c.total === 0) return 'muted';
    if (c.failed > 0) return 'warn';
    if (c.processing > 0 || c.pending > 0) return 'accent';
    return 'health';
  }
  function jobChipLabel(c: JobCounts): string {
    if (c.total === 0) return 'NO DATA';
    if (c.failed > 0) return `${c.failed} FAILED`;
    if (c.processing > 0) return 'RUNNING';
    if (c.pending > 0) return `${c.pending} QUEUED`;
    return 'DONE';
  }

  const totalDone24h = $derived(
    queueData ? Object.values(queueData.byJobType).reduce((s, c) => s + c.done24h, 0) : 0
  );
  // Digest readiness metadata
  const READINESS_META = [
    { key: 'ytm'         as const, label: 'YTM playlist links',    src: 'ytm_link_cache'      },
    { key: 'lastfm_pop'  as const, label: 'Tastemaker leaderboard', src: 'song_popularity'    },
    { key: 'lastfm_tags' as const, label: 'Genre & mood blurbs',    src: 'song_popularity'    },
    { key: 'lyrics'      as const, label: 'Lyrical metrics',        src: 'song_lyrics_metrics' },
    { key: 'audio'       as const, label: 'Audio insights',         src: 'song_audio_features' },
  ];

  const CELL_COL = ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'audio'] as const;
  const CELL_HEADER = ['YTM', 'Pop', 'Tags', 'Lyr', 'Audio'];

  let fillGapsLoading = $state(false);
  let fillGapsToast = $state<string | null>(null);

  const blockedCount = $derived(
    queueData?.digestReadiness
      ? READINESS_META.filter(m => !queueData!.digestReadiness![m.key].ok).length
      : 0
  );
  const songsToEnrich = $derived(
    queueData?.coverageMatrix
      ? queueData.coverageMatrix.filter(row =>
          (['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics'] as const).some(
            jt => row.jobs[jt] === 'missing' || row.jobs[jt] === 'failed'
          )
        ).length
      : 0
  );

  let failuresOpen = $state(true);
  let retryingId = $state<number | null>(null);

  async function retryJob(id: number) {
    retryingId = id;
    try {
      const r = await fetch('/api/metadata-queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.ok && queueData) {
        queueData = { ...queueData, failures: queueData.failures.filter(f => f.id !== id) };
      }
    } catch { /* ignore */ } finally {
      retryingId = null;
    }
  }

  async function fillGaps() {
    if (selectedScope == null || fillGapsLoading) return;
    fillGapsLoading = true;
    fillGapsToast = null;
    try {
      const r = await fetch('/api/metadata-queue/fill-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: selectedScope }),
      });
      if (r.ok) {
        const body = (await r.json()) as { queued: number };
        fillGapsToast = `Queued ${body.queued} jobs`;
        const res = await fetch(`/api/metadata-queue/status?roundId=${selectedScope}`);
        if (res.ok) queueData = (await res.json()) as QueueStatusPayload;
        setTimeout(() => { fillGapsToast = null; }, 3500);
      }
    } catch { /* ignore */ } finally {
      fillGapsLoading = false;
    }
  }

  const overallTone = $derived(
    !queueData ? 'muted'
    : queueData.failures.length > 0 ? 'warn'
    : queueData.totalPending > 0 || queueData.totalProcessing > 0 ? 'accent'
    : 'health'
  );
  const overallLabel = $derived(
    !queueData ? 'LOADING'
    : queueData.failures.length > 0 ? `${queueData.failures.length} FAILURE${queueData.failures.length === 1 ? '' : 'S'}`
    : queueData.totalProcessing > 0 ? `RUNNING · ${queueData.totalProcessing}`
    : queueData.totalPending > 0 ? `${queueData.totalPending} PENDING`
    : 'IDLE'
  );

  // Load on mount
  $effect(() => {
    loadDebugMode();
    loadAutoAnalyze();
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

<!-- ── Song Metadata Queue panel ─────────────────────────────────────────── -->
<section
  class="bg-surface border border-border-muted rounded-xl p-6 mt-6 mb-6"
  style="border-left: 3px solid var(--color-accent);"
>
  <!-- Header -->
  <header class="flex items-center justify-between gap-3 mb-4 flex-wrap">
    <div>
      <SectionLabel>Enrichment</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">Song metadata queue</h2>
    </div>
    <StatusChip label={overallLabel} tone={overallTone} />
  </header>

  <!-- Scope control -->
  <div class="flex flex-wrap gap-1.5 mb-5">
    <button
      type="button"
      onclick={() => { selectedScope = null; }}
      class="font-mono text-[10px] tracking-widest uppercase px-3 py-1 rounded-sm border transition-colors {selectedScope === null ? 'bg-accent text-bg border-accent' : 'bg-bg-elevated text-fg-dim border-border-muted hover:border-accent hover:text-fg'}"
    >
      All rounds
    </button>
    {#each data.recentRounds as round (round.id)}
      <button
        type="button"
        onclick={() => { selectedScope = round.id; }}
        class="font-mono text-[10px] tracking-widest uppercase px-3 py-1 rounded-sm border transition-colors max-w-[14rem] truncate {selectedScope === round.id ? 'bg-accent text-bg border-accent' : 'bg-bg-elevated text-fg-dim border-border-muted hover:border-accent hover:text-fg'}"
        title={round.name}
      >
        {round.name}
      </button>
    {/each}
  </div>

  <!-- 4 summary tiles -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Pending</SectionLabel>
      <div class="text-3xl font-display font-bold text-warn mt-1 leading-none">
        {queueData?.totalPending ?? '—'}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">queued</div>
    </div>
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Processing</SectionLabel>
      <div class="text-3xl font-display font-bold text-accent mt-1 leading-none">
        {queueData?.totalProcessing ?? '—'}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">active</div>
    </div>
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Done (24h)</SectionLabel>
      <div class="text-3xl font-display font-bold text-health mt-1 leading-none">
        {queueData ? totalDone24h : '—'}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">completed</div>
    </div>
    <div class="bg-bg-elevated border border-border-muted rounded-md p-3">
      <SectionLabel>Failures</SectionLabel>
      <div class="text-3xl font-display font-bold mt-1 leading-none {queueData && queueData.failures.length > 0 ? 'text-warn' : 'text-fg-faint'}">
        {queueData?.failures.length ?? '—'}
      </div>
      <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
        {queueData && queueData.failures.length > 0 ? 'needs retry' : 'clean'}
      </div>
    </div>
  </div>

  <!-- 5 per-job rows -->
  <div class="space-y-2">
    {#each JOB_ORDER as jobType (jobType)}
      {@const meta = JOB_META[jobType]}
      {@const counts = queueData?.byJobType[jobType] ?? { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 }}
      {@const done = jobDone(counts)}
      {@const progress = jobProgress(counts)}
      <div class="flex items-center gap-3 py-2 border-t border-border-muted first:border-t-0">
        <!-- Name + provider -->
        <div class="w-52 shrink-0">
          <div class="text-sm text-fg font-medium leading-tight">{meta.name}</div>
          <div class="font-mono text-[10px] text-fg-faint mt-0.5">
            {meta.provider} · {meta.speed}
          </div>
        </div>
        <!-- Progress bar -->
        <div class="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500 {counts.total === 0 ? 'bg-fg-faint/20' : 'bg-health'}"
            style="width: {(progress * 100).toFixed(1)}%"
          ></div>
        </div>
        <!-- done / total -->
        <div class="font-mono text-xs text-fg-muted w-16 text-right shrink-0">
          {counts.total === 0 ? '—' : `${done}/${counts.total}`}
        </div>
        <!-- Status chip (audio gets pulsing dot when running) -->
        <div class="shrink-0 flex items-center gap-1.5">
          {#if jobType === 'audio' && counts.processing > 0}
            <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block"></span>
          {/if}
          <StatusChip label={jobChipLabel(counts)} tone={jobChipTone(counts)} />
        </div>
      </div>
    {/each}
  </div>

  <!-- Digest readiness + Coverage matrix — round-scoped only -->
  {#if selectedScope != null && queueData?.digestReadiness}
    {@const dr = queueData.digestReadiness}

    <!-- Digest readiness block -->
    <div class="mt-6 border-t border-border-muted pt-5">
      <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Digest readiness</span>
          <div class="text-sm font-semibold text-fg mt-0.5">
            {#if blockedCount === 0}
              All metadata sections ready
            {:else}
              {blockedCount} section{blockedCount === 1 ? '' : 's'} blocked
            {/if}
          </div>
        </div>
        <div class="flex items-center gap-2">
          {#if fillGapsToast}
            <span class="font-mono text-[10px] tracking-widest uppercase text-health">{fillGapsToast}</span>
          {/if}
          {#if blockedCount > 0}
            <button
              type="button"
              onclick={fillGaps}
              disabled={fillGapsLoading}
              class="font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 rounded-sm border transition-colors {fillGapsLoading ? 'border-border-muted text-fg-faint cursor-not-allowed' : 'border-accent text-accent hover:bg-accent hover:text-bg'}"
            >
              {fillGapsLoading ? 'Enqueueing…' : `Fill gaps · enrich ${songsToEnrich}`}
            </button>
          {/if}
        </div>
      </div>

      <div class="space-y-0">
        {#each READINESS_META as row (row.key)}
          {@const item = dr[row.key]}
          <div class="flex items-center gap-3 py-2 border-t border-border-muted first:border-t-0">
            <span class="text-base w-5 shrink-0 {item.ok ? 'text-health' : 'text-warn'}">{item.ok ? '✓' : '!'}</span>
            <span class="text-sm text-fg flex-1">{row.label}</span>
            <span class="font-mono text-[11px] text-fg-faint">{row.src} · {item.count}/{item.total}</span>
            {#if item.ok}
              <StatusChip label="READY" tone="health" />
            {:else}
              <StatusChip label="BLOCKED" tone="warn" />
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Coverage matrix -->
    {#if queueData.coverageMatrix && queueData.coverageMatrix.length > 0}
      <div class="mt-6 border-t border-border-muted pt-5">
        <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Coverage matrix</span>
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-xs min-w-[480px]">
            <thead>
              <tr>
                <th class="text-left py-1.5 pr-3 font-mono text-[10px] tracking-widest uppercase text-fg-faint font-normal w-48">Song</th>
                {#each CELL_HEADER as hdr, i (hdr)}
                  <th class="text-center py-1.5 px-2 font-mono text-[10px] tracking-widest uppercase text-fg-faint font-normal w-14" title={JOB_META[CELL_COL[i]].name}>{hdr}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each queueData.coverageMatrix as song (song.spotify_uri)}
                <tr class="border-t border-border-muted hover:bg-surface-hover">
                  <td class="py-1.5 pr-3 max-w-[12rem]">
                    <div class="truncate text-fg">{song.title ?? song.spotify_uri}</div>
                    {#if song.artist}<div class="truncate text-fg-faint text-[10px]">{song.artist}</div>{/if}
                  </td>
                  {#each CELL_COL as jt (jt)}
                    {@const st = song.jobs[jt]}
                    <td class="py-1.5 px-2 text-center">
                      {#if st === 'done'}
                        <span class="text-health text-base leading-none" title="done">●</span>
                      {:else if st === 'processing'}
                        <span class="text-accent text-base leading-none animate-pulse" title="processing">●</span>
                      {:else if st === 'pending'}
                        <span class="text-accent/50 text-base leading-none" title="queued">○</span>
                      {:else if st === 'failed'}
                        <span class="text-warn font-bold" title="failed">✗</span>
                      {:else}
                        <span class="text-fg-faint" title="missing">—</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Failures list — all-rounds scope only -->
  {#if selectedScope == null && queueData && queueData.failures.length > 0}
    <div class="mt-6 border-t border-border-muted pt-5">
      <button
        type="button"
        onclick={() => { failuresOpen = !failuresOpen; }}
        class="w-full flex items-center justify-between gap-2 text-left group"
      >
        <span class="font-mono text-[10px] tracking-widest uppercase text-warn">
          Failures ({queueData.failures.length})
          · {queueData.failures.reduce((s, f) => s + f.retries, 0)} retries used
        </span>
        <span class="text-fg-faint text-xs group-hover:text-fg transition-colors">{failuresOpen ? '▲' : '▼'}</span>
      </button>

      {#if failuresOpen}
        <div class="mt-3 space-y-0">
          {#each queueData.failures as f (f.id)}
            <div class="flex items-start gap-3 py-2 border-t border-border-muted first:border-t-0">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-fg font-medium truncate">{f.spotify_uri.split(':').pop()}</div>
                <div class="font-mono text-[10px] text-fg-faint mt-0.5">
                  {JOB_META[f.job_type]?.provider ?? f.job_type} · {f.job_type}
                  {#if f.retries > 0} · {f.retries}/3 retries{/if}
                </div>
                {#if f.error}
                  <div class="text-warn text-[11px] mt-0.5 truncate">{f.error}</div>
                {/if}
              </div>
              <button
                type="button"
                onclick={() => retryJob(f.id)}
                disabled={retryingId === f.id}
                class="font-mono text-[10px] tracking-widest uppercase shrink-0 transition-colors {retryingId === f.id ? 'text-fg-faint cursor-not-allowed' : 'text-accent hover:text-accent-strong'}"
              >
                {retryingId === f.id ? '…' : 'Retry ↻'}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Auto-enrich footer — always visible -->
  <div class="mt-6 border-t border-border-muted pt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
    <div>
      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint block mb-2">Auto-enrich on import</span>
      <div class="flex flex-wrap gap-1.5">
        {#each ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics'] as jt (jt)}
          <span class="inline-flex items-center gap-1 border border-health/40 bg-health-bg text-health font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-sm">
            ✓ {JOB_META[jt].name.split(' ')[0]}
          </span>
        {/each}
        {#if autoAnalyzeEnabled}
          <span class="inline-flex items-center gap-1 border border-health/40 bg-health-bg text-health font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-sm">
            ✓ audio
          </span>
        {:else}
          <span class="inline-flex items-center gap-1 border border-dashed border-border text-fg-faint font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-sm">
            audio · manual
          </span>
        {/if}
      </div>
    </div>
    <label class="inline-flex items-center gap-2 cursor-pointer select-none ml-auto">
      <input
        type="checkbox"
        bind:checked={autoAnalyzeEnabled}
        onchange={toggleAutoAnalyze}
        disabled={autoAnalyzeLoading}
        class="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
      />
      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-muted">Include audio</span>
    </label>
  </div>
</section>

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
