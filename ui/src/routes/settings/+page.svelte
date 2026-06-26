<script lang="ts">
  import type { PageData } from './$types.js';
  import { enhance } from '$app/forms';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';
  import MetricTiles from '$lib/metadata-queue/MetricTiles.svelte';
  import JobTypeRollups from '$lib/metadata-queue/JobTypeRollups.svelte';
  import HeatmapView from '$lib/metadata-queue/HeatmapView.svelte';
  import type { Filter } from '$lib/metadata-queue/metricTiles.js';
  import type { Scope, HierarchyLeague, ChildRollup } from '$lib/db/metadataQueue.js';
  import HierarchyNavigator from '$lib/metadata-queue/HierarchyNavigator.svelte';
  import EnrichControl from '$lib/metadata-queue/EnrichControl.svelte';
  import { rollupChip } from '$lib/metadata-queue/ladder.js';
  import QueueSongCard from '$lib/metadata-queue/QueueSongCard.svelte';
  import Triage from '$lib/metadata-queue/Triage.svelte';

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
    done: number; // lifetime done — added by Task 2; required by MetricTiles
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
    failures: Array<{
      id: number;
      spotify_uri: string;
      job_type: string;
      error: string | null;
      retries: number;
      round_id: number | null;
      round_name: string | null;
    }>;
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

  let scope = $state<Scope>({ level: 'all' });
  let queueData = $state<QueueStatusPayload | null>(null);
  let filter = $state<Filter>('all');
  let triageOpen = $state(false);

  // Live hierarchy — seeded from the SSR load, then refreshed client-side so the
  // HierarchyNavigator status chips reflect completions without a full page
  // reload. `data.hierarchy` alone is fetched once at load and goes stale.
  let hierarchy = $state<HierarchyLeague[]>(data.hierarchy as HierarchyLeague[]);

  async function refreshHierarchy() {
    try {
      const r = await fetch('/api/metadata-queue/hierarchy');
      if (r.ok) hierarchy = ((await r.json()) as { hierarchy: HierarchyLeague[] }).hierarchy;
    } catch { /* silently ignore */ }
  }

  // ── View toggle: 'rows' (JobTypeRollups) | 'heatmap' (HeatmapView) ──────
  type ViewMode = 'rows' | 'heatmap';
  let view = $state<ViewMode>('rows');

  // Round-scope sub-toggle: 'songs' | 'rounds' (sibling rounds of same season)
  type RoundSubView = 'songs' | 'rounds';
  let roundSubView = $state<RoundSubView>('songs');

  // Heatmap data — fetched lazily on toggle/scope-change; NOT in the 10s poll.
  let heatmapChildren = $state<ChildRollup[] | null>(null);
  let heatmapFetching = $state(false);
  // Request guard: only the latest token's result is applied.
  let heatmapToken = $state(0);

  /**
   * Fetch children rollups for the heatmap. Called on view=heatmap toggle and
   * scope changes (only when heatmap is active). Uses a token-based request
   * guard to prevent stale responses from racing into state.
   */
  async function fetchHeatmapChildren(s: Scope) {
    const token = ++heatmapToken;
    heatmapFetching = true;
    try {
      const url = s.level === 'all'
        ? '/api/metadata-queue/children?level=all'
        : `/api/metadata-queue/children?level=${s.level}&id=${s.id}`;
      const r = await fetch(url);
      if (r.ok && heatmapToken === token) {
        const body = (await r.json()) as { children: ChildRollup[] };
        heatmapChildren = body.children;
      }
    } catch { /* silently ignore */ } finally {
      if (heatmapToken === token) heatmapFetching = false;
    }
  }

  // Fetch heatmap data on scope change when heatmap is active, or when
  // view is switched to heatmap. NOT triggered by the 10s status poll.
  $effect(() => {
    const s = scope;
    const v = view;
    if (v === 'heatmap' && s.level !== 'round') {
      // Reset children while loading to avoid stale grid
      heatmapChildren = null;
      fetchHeatmapChildren(s);
    }
    // At round scope, heatmap uses coverageMatrix from queueData — no extra fetch.
  });

  // At round scope + heatmap + roundSubView='rounds': fetch sibling rounds.
  // We need the parent season id. Look it up in the hierarchy.
  let siblingRoundChildren = $state<ChildRollup[] | null>(null);
  let siblingFetching = $state(false);
  let siblingToken = $state(0);

  $effect(() => {
    const s = scope;
    const v = view;
    const rsv = roundSubView;
    if (v !== 'heatmap' || s.level !== 'round' || rsv !== 'rounds') return;
    // Find parent season_id from hierarchy
    let parentSeasonId: number | null = null;
    outer: for (const league of hierarchy) {
      for (const season of league.seasons) {
        for (const round of season.rounds) {
          if (round.id === s.id) { parentSeasonId = season.id; break outer; }
        }
      }
    }
    if (parentSeasonId == null) return;
    const seasonId = parentSeasonId;
    const token = ++siblingToken;
    siblingFetching = true;
    siblingRoundChildren = null;
    fetch(`/api/metadata-queue/children?level=season&id=${seasonId}`)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (siblingToken === token && body) {
          siblingRoundChildren = (body as { children: ChildRollup[] }).children;
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (siblingToken === token) siblingFetching = false; });
  });

  // Status poll — 10s interval, scoped to status endpoint only.
  $effect(() => {
    const s = scope;
    async function doFetch() {
      const url = s.level === 'all'
        ? '/api/metadata-queue/status'
        : `/api/metadata-queue/status?level=${s.level}&id=${s.id}`;
      try {
        const r = await fetch(url);
        if (r.ok) queueData = (await r.json()) as QueueStatusPayload;
      } catch { /* silently ignore */ }
      // Keep the navigator chips in sync with background worker progress.
      refreshHierarchy();
    }
    doFetch();
    const interval = setInterval(doFetch, 10000);
    return () => clearInterval(interval);
  });

  const totalDone24h = $derived(
    queueData ? Object.values(queueData.byJobType).reduce((s, c) => s + c.done24h, 0) : 0
  );
  // approxSongs: exact when coverageMatrix present (round scope); otherwise estimate as
  // ceil(total / 4) — typical songs have 4–5 job types, so total/4 is a conservative bound.
  // The "~" prefix in failedLabel signals the value is approximate.
  const approxSongs = $derived(
    queueData?.coverageMatrix
      ? queueData.coverageMatrix.length
      : queueData
        ? Math.ceil(Object.values(queueData.byJobType).reduce((s, c) => s + c.total, 0) / 4)
        : 0
  );
  // Digest readiness metadata
  const READINESS_META = [
    { key: 'ytm'         as const, label: 'YTM playlist links',    src: 'ytm_link_cache'      },
    { key: 'lastfm_pop'  as const, label: 'Tastemaker leaderboard', src: 'song_popularity'    },
    { key: 'lastfm_tags' as const, label: 'Genre & mood blurbs',    src: 'song_popularity'    },
    { key: 'lyrics'      as const, label: 'Lyrical metrics',        src: 'song_lyrics_metrics' },
    { key: 'audio'       as const, label: 'Audio insights',         src: 'song_audio_features' },
  ];

  let fillGapsLoading = $state(false);
  let fillGapsToast = $state<string | null>(null);

  const blockedCount = $derived(
    queueData?.digestReadiness
      ? READINESS_META.filter(m => !queueData!.digestReadiness![m.key].ok).length
      : 0
  );


  async function bulkAction(ids: number[], action: 'retry' | 'dismiss') {
    try {
      const r = await fetch('/api/metadata-queue/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      });
      if (r.ok) {
        // Refetch status to reconcile state after bulk action
        const statusUrl = scope.level === 'all'
          ? '/api/metadata-queue/status'
          : `/api/metadata-queue/status?level=${scope.level}&id=${scope.id}`;
        const res = await fetch(statusUrl);
        if (res.ok) queueData = (await res.json()) as QueueStatusPayload;
        refreshHierarchy();
      }
    } catch { /* ignore */ }
  }

  /**
   * enqueueOne — POST a single (uri, job_type) to the Task-8 /enqueue endpoint.
   * On success, optimistically flips that element to 'pending' in the local
   * coverageMatrix so the pill updates immediately. The 10s poll reconciles to
   * real state.
   */
  async function enqueueOne(uri: string, jobType: string) {
    try {
      const r = await fetch('/api/metadata-queue/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, job_type: jobType }),
      });
      if (r.ok && queueData?.coverageMatrix) {
        // Optimistic flip: mark that element as pending so the pill updates immediately.
        queueData = {
          ...queueData,
          coverageMatrix: queueData.coverageMatrix.map(row =>
            row.spotify_uri === uri
              ? { ...row, jobs: { ...row.jobs, [jobType]: 'pending' as const } }
              : row
          ),
        };
      }
    } catch { /* silently ignore — poll will reconcile */ }
  }

  function enqueueRunMissing(uri: string) {
    for (const jt of JOB_ORDER) {
      const row = queueData?.coverageMatrix?.find(r => r.spotify_uri === uri);
      if (!row) continue;
      const state = row.jobs[jt] ?? 'missing';
      if (state !== 'done' && state !== 'processing') {
        enqueueOne(uri, jt);
      }
    }
  }

  function enqueueAll(uri: string) {
    for (const jt of JOB_ORDER) {
      enqueueOne(uri, jt);
    }
  }

  async function fillGaps() {
    if (fillGapsLoading) return;
    fillGapsLoading = true;
    fillGapsToast = null;
    try {
      const r = await fetch('/api/metadata-queue/fill-gaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: scope.level, id: scope.id }),
      });
      if (r.ok) {
        const body = (await r.json()) as { queued: number };
        fillGapsToast = `Queued ${body.queued} jobs`;
        const statusUrl = scope.level === 'all'
          ? '/api/metadata-queue/status'
          : `/api/metadata-queue/status?level=${scope.level}&id=${scope.id}`;
        const res = await fetch(statusUrl);
        if (res.ok) queueData = (await res.json()) as QueueStatusPayload;
        refreshHierarchy();
        setTimeout(() => { fillGapsToast = null; }, 3500);
      }
    } catch { /* ignore */ } finally {
      fillGapsLoading = false;
    }
  }

  // Enrich-count estimate for the EnrichControl label.
  // The endpoint's returned {queued} is the source of truth shown in the toast.
  const enrichableTypes = ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics'] as const;

  const enrichCount = $derived.by(() => {
    const songsInScope = (() => {
      if (scope.level === 'round') {
        return queueData?.coverageMatrix?.length ?? 0;
      }
      if (scope.level === 'all') {
        return hierarchy.reduce((sum: number, league: HierarchyLeague) => sum + league.songCount, 0);
      }
      if (scope.level === 'league') {
        const league = hierarchy.find((l: HierarchyLeague) => l.id === scope.id);
        return league?.songCount ?? 0;
      }
      // season
      for (const league of hierarchy) {
        const season = league.seasons.find(s => s.id === scope.id);
        if (season) return season.songCount;
      }
      return 0;
    })();

    const existingEnrichable = enrichableTypes.reduce(
      (sum, jt) => sum + (queueData?.byJobType[jt]?.total ?? 0),
      0
    );
    const failedEnrichable = enrichableTypes.reduce(
      (sum, jt) => sum + (queueData?.byJobType[jt]?.failed ?? 0),
      0
    );
    const missing = Math.max(0, songsInScope * enrichableTypes.length - existingEnrichable);
    return missing + failedEnrichable;
  });

  const overallChip = $derived(
    queueData
      ? rollupChip({
          pending: queueData.totalPending,
          processing: queueData.totalProcessing,
          done24h: 0,
          failed: queueData.failures.length,
          total: Object.values(queueData.byJobType).reduce((s, c) => s + c.total, 0),
        })
      : { label: 'LOADING', tone: 'muted' as const }
  );

  // Load on mount
  $effect(() => {
    loadDebugMode();
    loadAutoAnalyze();
  });

  // Legacy weights (read-only — frozen once all surfaces migrate)
  const wLegacy = data.settings;
  const wLegacyTotal = wLegacy.weightDiscovery + wLegacy.weightThemeFit + wLegacy.weightPersonal + wLegacy.weightNostalgia;
  const legacyDeprecated = !!data.settings.legacyWeightsDeprecatedAt;

  // Universal songcard weights (editable)
  let w = $state({
    weightDiscovery:     data.settings.weightDiscovery,
    weightThemeFit:      data.settings.weightThemeFit,
    weightQuality:       data.settings.weightQuality,
    weightReplayability: data.settings.weightReplayability,
  });
  let wTotal = $derived(w.weightDiscovery + w.weightThemeFit + w.weightQuality + w.weightReplayability);
  const totalOk = $derived(Math.abs(wTotal - 100) <= 1);

  function resetWeights() {
    w = { weightDiscovery: 30, weightThemeFit: 40, weightQuality: 20, weightReplayability: 10 };
  }

  // Last successful import for the import-card header chip.
  const lastSuccess = $derived(
    data.importLog.find((e: { status: string }) => e.status === 'success') ?? null
  );
  const hasFailedImport = $derived(
    data.importLog.some((e: { status: string }) => e.status === 'error')
  );

  type WeightField = 'weightDiscovery' | 'weightThemeFit' | 'weightQuality' | 'weightReplayability';
  const weightFields: Array<{ field: WeightField; label: string; dot: string; tooltip: string }> = [
    {
      field: 'weightDiscovery',
      label: 'Discovery',
      dot: 'bg-sky',
      tooltip: 'Likelihood this is new to the league — niche or underrated.'
    },
    {
      field: 'weightThemeFit',
      label: 'Theme fit',
      dot: 'bg-ember',
      tooltip: "How well the song matches the round's stated theme."
    },
    {
      field: 'weightQuality',
      label: 'Quality',
      dot: 'bg-moss',
      tooltip: 'Intrinsic quality and craft of the song.'
    },
    {
      field: 'weightReplayability',
      label: 'Replayability',
      dot: 'bg-amber',
      tooltip: 'How often you want to revisit it.'
    }
  ];
  const weightFieldKeys: WeightField[] = weightFields.map((f) => f.field);

  type LegacyWeightField = 'weightDiscovery' | 'weightThemeFit' | 'weightPersonal' | 'weightNostalgia';
  const legacyWeightFields: Array<{ field: LegacyWeightField; label: string; dot: string }> = [
    { field: 'weightDiscovery', label: 'Discovery potential', dot: 'bg-health' },
    { field: 'weightThemeFit',  label: 'Theme fit',           dot: 'bg-accent' },
    { field: 'weightPersonal',  label: 'Personal rating',     dot: 'bg-warn' },
    { field: 'weightNostalgia', label: 'Nostalgia potential', dot: 'bg-accent-strong' },
  ];

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
    <StatusChip label={overallChip.label} tone={overallChip.tone} />
  </header>

  <!-- Hierarchy navigator (scope drill-down) -->
  <HierarchyNavigator
    {hierarchy}
    {scope}
    onScope={(s) => { scope = s; filter = 'all'; }}
  />

  <!-- 4 metric tiles: Queued / Running / Done / Failed — filter-aware, monotonic colors -->
  {#if queueData}
    <MetricTiles
      byJobType={queueData.byJobType}
      approxSongs={approxSongs}
      filter={filter}
      onFilter={(f) => {
        filter = f;
        if (f === 'failed') triageOpen = true;
      }}
    />
  {:else}
    <!-- skeleton while loading -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {#each [0,1,2,3] as _}
        <div class="bg-bg-elevated border border-border-muted rounded-md p-3 animate-pulse h-24"></div>
      {/each}
    </div>
  {/if}

  <!-- Always-visible enrich control -->
  <div class="mb-4">
    <EnrichControl
      {scope}
      n={enrichCount}
      loading={fillGapsLoading}
      onEnrich={fillGaps}
    />
    {#if fillGapsToast}
      <span class="ml-3 font-mono text-[10px] tracking-widest uppercase text-health">{fillGapsToast}</span>
    {/if}
  </div>

  <!-- View toggle: [ rows | heatmap ] -->
  <div class="flex items-center gap-1 mb-4">
    <div class="inline-flex rounded-md border border-border-muted overflow-hidden">
      <button
        type="button"
        onclick={() => { view = 'rows'; }}
        class="px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase transition-colors {view === 'rows' ? 'bg-accent text-bg-elevated' : 'bg-transparent text-fg-muted hover:text-fg'}"
      >
        rows
      </button>
      <button
        type="button"
        onclick={() => { view = 'heatmap'; }}
        class="px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase border-l border-border-muted transition-colors {view === 'heatmap' ? 'bg-accent text-bg-elevated' : 'bg-transparent text-fg-muted hover:text-fg'}"
      >
        heatmap
      </button>
    </div>

    <!-- [songs | rounds] sub-toggle at round scope inside heatmap mode -->
    {#if scope.level === 'round' && view === 'heatmap'}
      <div class="inline-flex rounded-md border border-border-muted overflow-hidden ml-3">
        <button
          type="button"
          onclick={() => { roundSubView = 'songs'; }}
          class="px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase transition-colors {roundSubView === 'songs' ? 'bg-accent text-bg-elevated' : 'bg-transparent text-fg-muted hover:text-fg'}"
        >
          songs
        </button>
        <button
          type="button"
          onclick={() => { roundSubView = 'rounds'; }}
          class="px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase border-l border-border-muted transition-colors {roundSubView === 'rounds' ? 'bg-accent text-bg-elevated' : 'bg-transparent text-fg-muted hover:text-fg'}"
        >
          rounds
        </button>
      </div>
    {/if}
  </div>

  {#if view === 'heatmap'}
    {#if scope.level === 'round'}
      {#if roundSubView === 'songs'}
        <!-- Songs heatmap: use polled coverageMatrix (no extra fetch needed) -->
        <HeatmapView
          coverageMatrix={queueData?.coverageMatrix}
          jobMeta={JOB_META}
        />
      {:else}
        <!-- Sibling rounds heatmap -->
        {#if siblingFetching}
          <div class="font-mono text-[10px] text-fg-faint py-4">Loading sibling rounds...</div>
        {:else}
          <HeatmapView
            children={siblingRoundChildren ?? []}
            jobMeta={JOB_META}
          />
        {/if}
      {/if}
    {:else}
      <!-- All/league/season scope: use fetched children -->
      {#if heatmapFetching}
        <div class="font-mono text-[10px] text-fg-faint py-4">Loading heatmap...</div>
      {:else}
        <HeatmapView
          children={heatmapChildren ?? []}
          jobMeta={JOB_META}
        />
      {/if}
    {/if}
  {:else}
    <!-- 5 per-job rows (segmented rollup bars) -->
    <JobTypeRollups
      byJobType={queueData?.byJobType}
      jobMeta={JOB_META}
      jobOrder={JOB_ORDER}
    />
  {/if}

  <!-- Digest readiness + Coverage matrix — round-scoped only -->
  {#if scope.level === 'round' && queueData?.digestReadiness}
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

    <!-- Song metadata queue cards — per-song, per-element run -->
    {#if queueData.coverageMatrix && queueData.coverageMatrix.length > 0}
      <div class="mt-6 border-t border-border-muted pt-5">
        <div class="flex items-center justify-between mb-3">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Song metadata queue</span>
          <span class="font-mono text-[10px] text-fg-faint">{queueData.coverageMatrix.length} songs</span>
        </div>
        <div class="space-y-3">
          {#each queueData.coverageMatrix as song (song.spotify_uri)}
            <QueueSongCard
              {song}
              jobOrder={JOB_ORDER}
              jobMeta={JOB_META}
              onRunElement={enqueueOne}
              onRunMissing={enqueueRunMissing}
              onEnrichAll={enqueueAll}
            />
          {/each}
        </div>
        <!-- Last.fm shared rate-limit note (lastfm_pop + lastfm_tags share the limit) -->
        <div class="mt-4 flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-amber/20">
          <span class="text-amber font-mono text-[10px]">&#9650;</span>
          <span class="text-amber text-xs font-mono">
            Last.fm rate limit shared — <code class="text-[10px]">lastfm_pop</code> and <code class="text-[10px]">lastfm_tags</code> draw from the same quota. Enrich them together or in sequence.
          </span>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Triage — grouped failures (collapsible, opens when Failed tile clicked) -->
  {#if queueData && queueData.failures.length > 0}
    <div class="mt-6 border-t border-border-muted pt-5">
      <button
        type="button"
        onclick={() => { triageOpen = !triageOpen; }}
        class="flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-amber hover:text-amber/80 transition-colors mb-3"
      >
        <span>{triageOpen ? '▾' : '▸'}</span>
        <span>Failures ({queueData.failures.length})</span>
      </button>
      {#if triageOpen}
        <Triage
          failures={queueData.failures}
          jobMeta={JOB_META}
          onBulkAction={bulkAction}
        />
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
<!-- Section 1: Rating Weights (left column) — dual panels -->
<div class="flex flex-col gap-4">

<!-- Universal Songcard weights panel (active, editable) -->
<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="mb-1 flex items-center gap-3">
    <div class="flex-1">
      <SectionLabel>Universal songcard</SectionLabel>
      <h2 class="text-lg font-bold text-fg mt-1">Rating weights</h2>
    </div>
    <StatusChip label="ACTIVE" tone="accent" />
  </header>
  <p class="text-xs text-fg-dim mb-4">
    Four axes, sums to 100. Score = <code class="font-mono text-fg">Σ(rating × weight) / Σ(weight) × 4</code> → /20.
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

  <form method="POST" action="?/updateUnicardWeights" use:enhance class="space-y-4">
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
      <div class="bg-sky transition-all" style="width:{w.weightDiscovery}%"></div>
      <div class="bg-ember transition-all" style="width:{w.weightThemeFit}%"></div>
      <div class="bg-moss transition-all" style="width:{w.weightQuality}%"></div>
      <div class="bg-amber transition-all" style="width:{w.weightReplayability}%"></div>
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

<!-- Legacy weights panel (frozen, read-only) — hidden once all surfaces migrated -->
{#if !legacyDeprecated}
<section class="bg-surface border border-dashed border-border-muted rounded-xl p-6 opacity-60">
  <header class="mb-1 flex items-center gap-3">
    <div class="flex-1">
      <SectionLabel>Legacy cards</SectionLabel>
      <h2 class="text-lg font-bold text-fg-muted mt-1">Rating weights (legacy)</h2>
    </div>
    <StatusChip label="DEPRECATED" tone="muted" />
  </header>
  <p class="text-xs text-fg-dim mb-4">
    Applies only to pre-unicard surfaces. Frozen — remove this panel once every surface is on the universal songcard.
  </p>
  <div class="space-y-3">
    {#each legacyWeightFields as { field, label, dot } (field)}
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 w-52">
          <span class="w-2 h-2 rounded-full {dot} shrink-0 opacity-50"></span>
          <span class="text-sm text-fg-dim">{label}</span>
        </div>
        <div class="flex-1 h-2 rounded-sm bg-border-muted overflow-hidden">
          <div class="h-full bg-fg-dim opacity-40 transition-all" style="width:{wLegacy[field]}%"></div>
        </div>
        <span class="w-12 text-right text-sm font-mono text-fg-dim">
          {wLegacy[field]}%
        </span>
      </div>
    {/each}
    <div class="pt-1 text-xs font-mono text-fg-dim">Total: {wLegacyTotal}%</div>
  </div>
</section>
{/if}

</div>

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
