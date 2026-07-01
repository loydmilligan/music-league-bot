<script lang="ts" module>
  // History → Tab 3 "Player research". Pick a player from the roster → see
  // their submitted songs, win rate, and taste overlap with everyone else.
  // Data (sprint-24, backend lane):
  //   GET /api/history/players        → [{ name, songsSubmitted, winRate }]
  //   GET /api/history/players/:name  → { songs:[{round,title,artist,points}],
  //                                       winRate, tasteOverlap:{ name: score } }
  //
  // ── VIZ INTEGRATION SEAM (sprint-24, taste-overlap) ────────────────────
  // This tab owns scaffolding + data wiring ONLY. The taste-overlap viz (ranked
  // overlap bars) layers on WITHOUT editing this file, via the markup the
  // overlap section emits:
  //     <div class="taste-overlap">
  //       <div class="taste-overlap-row" data-name="…" data-score="0.42">…</div>
  // Rows arrive pre-sorted (highest overlap first). Write global CSS keyed on
  // `.taste-overlap-row` (use the data-score for bar width) — reusing the
  // sprint-23 color encoding. Do not refetch; consume the data already loaded.
  // ───────────────────────────────────────────────────────────────────────
  export type PlayerSummary = {
    name: string;
    songsSubmitted: number;
    winRate: number;
  };
  export type PlayerSong = {
    round: string;
    title: string;
    artist: string;
    points: number;
  };
  export type PlayerDetail = {
    songs: PlayerSong[];
    winRate: number;
    tasteOverlap: Record<string, number>;
  };
  export type DossierProfile = {
    player_id: number;
    notes: string | null;
    tags: string[];
    taste_fingerprint: unknown | null;
    fingerprint_model: string | null;
    fingerprint_cost_usd: number | null;
    fingerprint_generated_at: string | null;
    updated_at: string | null;
  };
  export type FingerprintOutput = {
    signature_artists: string[];
    genres: string[];
    eras: string[];
    rewards: string[];
    punishes: string[];
    summary: string;
    confidence: 'low' | 'medium' | 'high';
  };
  export type FingerprintResult = {
    fingerprint: FingerprintOutput;
    model: string;
    cost_usd: number;
    generated_at: string;
  };
  export type ThemeEntry = {
    theme: string;
    season: string;
    round: string;
  };
  export type OpenRound = {
    id: number;
    name: string;
    description: string | null;
    leagueName: string;
    submissionDeadline: string | null;
  };
  export type VoteProbeResult = {
    upvote_likelihood: number;
    expected_points: number;
    confidence: 'low' | 'medium' | 'high';
    reasoning: string;
    signals: string[];
    model: string;
    cost_usd: number;
    latency_ms: number;
    generated_at: string;
    cache_hit: boolean;
  };
  export type SubmissionProfile = {
    genres: string[];
    artists_or_types: string[];
    era: string;
    mood_energy: string;
    obscurity_lean: string;
    comment_likely: boolean;
    rationale: string;
  };
  export type SubmissionCandidate = {
    title: string;
    artist: string;
    why: string;
    spotify_url?: string;
    album_art_url?: string;
    resolved?: boolean;
  };
  export type SimilarPastPick = {
    title: string;
    artist: string;
    round: string;
    similarity: string;
  };
  export type SubmissionPrediction = {
    title: string;
    artist: string;
    spotify_url?: string;
    album_art_url?: string;
    detail: string;
    similar_past_picks: SimilarPastPick[];
    confidence: 'low' | 'medium' | 'high';
  };
  export type SubmissionPredictResult = {
    profile: SubmissionProfile;
    candidates: SubmissionCandidate[];
    prediction: SubmissionPrediction;
    model: string;
    cost_usd: number;
    latency_ms: number;
    generated_at: string;
    cache_hit: boolean;
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import TasteWaveform from '$lib/taste-waveform/TasteWaveform.svelte';
  import { tasteEngine, DEFAULT_TASTE_SETTINGS, type TasteBlock } from '$lib/taste-waveform/taste-waveform.js';

  let tasteBlock = $state<TasteBlock | null>(null);
  const tasteEng = $derived(tasteBlock ? tasteEngine(tasteBlock, DEFAULT_TASTE_SETTINGS) : null);
  const piOf = (name: string): number => tasteBlock ? tasteBlock.players.findIndex((p) => p.name === name) : -1;

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let players = $state<PlayerSummary[]>([]);
  // name → player_id from /api/players (only players in the players table)
  let playerIdMap = $state<Map<string, number>>(new Map());

  let selected = $state<string | null>(null);
  let detail = $state<PlayerDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);

  // Collapse state — all default collapsed (PR-1)
  let songsOpen = $state(false);
  let overlapOpen = $state(false);

  // Dossier state
  let dossier = $state<DossierProfile | null>(null);
  let dossierLoading = $state(false);
  let dossierError = $state<string | null>(null);
  let dossierOpen = $state(false);
  let draftNotes = $state('');
  let draftTags = $state('');
  let dossierSaving = $state(false);
  let dossierSaveError = $state<string | null>(null);
  let dossierSaved = $state(false);

  // Taste Fingerprint state
  let fingerprintOpen = $state(false);
  // Open rounds (PR-11): sourced from /api/rounds/open; grouped by league for theme pickers
  let openRounds = $state<OpenRound[]>([]);

  // Vote Probe state
  let probeOpen = $state(false);
  let probeSongTitle = $state('');
  let probeSongArtist = $state('');
  let probeSongUrl = $state('');
  let probeThemeKey = $state('');
  let probeLeagueFilter = $state<string | null>(null);
  let probeCustomThemeName = $state('');
  let probeCustomThemeDesc = $state('');
  let probeLoading = $state(false);
  let probeError = $state<string | null>(null);
  let probeResult = $state<VoteProbeResult | null>(null);
  let fingerprintLoading = $state(false);
  let fingerprintError = $state<string | null>(null);
  let fingerprintData = $state<FingerprintOutput | null>(null);
  let fingerprintProvenance = $state<{ model: string; cost_usd: number; generated_at: string } | null>(null);

  // Submission Predictor state
  let predictOpen = $state(false);
  let predictThemeKey = $state('');
  let predictLeagueFilter = $state<string | null>(null);
  let predictCustomThemeName = $state('');
  let predictCustomThemeDesc = $state('');
  let predictLoading = $state(false);
  let predictError = $state<string | null>(null);
  let predictResult = $state<SubmissionPredictResult | null>(null);

  onMount(async () => {
    try {
      const [histRes, playersRes, roundsRes, tasteRes] = await Promise.all([
        fetch('/api/history/players'),
        fetch('/api/players'),
        fetch('/api/rounds/open'),
        fetch('/api/history/taste'),
      ]);
      if (!histRes.ok) throw new Error(`Failed to load players (${histRes.status})`);
      players = await histRes.json();
      if (tasteRes.ok) tasteBlock = (await tasteRes.json()) as TasteBlock;
      if (playersRes.ok) {
        const allPlayers = (await playersRes.json()) as { id: number; name: string }[];
        playerIdMap = new Map(allPlayers.map((p) => [p.name, p.id]));
      }
      if (roundsRes.ok) {
        openRounds = (await roundsRes.json()) as OpenRound[];
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load players';
    } finally {
      loading = false;
    }
  });

  async function selectPlayer(name: string) {
    if (selected === name) {
      selected = null;
      detail = null;
      dossier = null;
      draftNotes = '';
      draftTags = '';
      fingerprintData = null;
      fingerprintProvenance = null;
      fingerprintError = null;
      probeResult = null;
      probeError = null;
      probeSongTitle = '';
      probeSongArtist = '';
      probeSongUrl = '';
      probeThemeKey = '';
      probeLeagueFilter = null;
      probeCustomThemeName = '';
      probeCustomThemeDesc = '';
      predictResult = null;
      predictError = null;
      predictThemeKey = '';
      predictLeagueFilter = null;
      predictCustomThemeName = '';
      predictCustomThemeDesc = '';
      return;
    }
    selected = name;
    detail = null;
    detailError = null;
    detailLoading = true;
    dossier = null;
    dossierError = null;
    dossierSaveError = null;
    dossierSaved = false;
    fingerprintData = null;
    fingerprintProvenance = null;
    fingerprintError = null;
    probeResult = null;
    probeError = null;
    probeSongTitle = '';
    probeSongArtist = '';
    probeSongUrl = '';
    probeThemeKey = '';
    probeLeagueFilter = null;
    probeCustomThemeName = '';
    probeCustomThemeDesc = '';
    predictResult = null;
    predictError = null;
    predictThemeKey = '';
    predictLeagueFilter = null;
    predictCustomThemeName = '';
    predictCustomThemeDesc = '';
    detailLoading = true;

    const playerId = playerIdMap.get(name);

    const [detailResult, dossierResult] = await Promise.allSettled([
      fetch(`/api/history/players/${encodeURIComponent(name)}`).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
        return res.json() as Promise<PlayerDetail>;
      }),
      playerId
        ? fetch(`/api/players/${playerId}/profile`).then(async (res) => {
            if (!res.ok) throw new Error(`Failed to load dossier (${res.status})`);
            return res.json() as Promise<DossierProfile>;
          })
        : Promise.resolve(null),
    ]);

    if (detailResult.status === 'fulfilled') {
      detail = detailResult.value;
    } else {
      detailError =
        detailResult.reason instanceof Error ? detailResult.reason.message : 'Failed to load player';
    }

    if (dossierResult.status === 'fulfilled' && dossierResult.value !== null) {
      dossier = dossierResult.value;
      draftNotes = dossier.notes ?? '';
      draftTags = dossier.tags.join(', ');
      if (dossier.taste_fingerprint) {
        fingerprintData = dossier.taste_fingerprint as FingerprintOutput;
        if (dossier.fingerprint_model && dossier.fingerprint_generated_at) {
          fingerprintProvenance = {
            model: dossier.fingerprint_model,
            cost_usd: dossier.fingerprint_cost_usd ?? 0,
            generated_at: dossier.fingerprint_generated_at,
          };
        }
      }
    } else if (dossierResult.status === 'rejected') {
      dossierError =
        dossierResult.reason instanceof Error ? dossierResult.reason.message : 'Failed to load dossier';
    }

    detailLoading = false;
  }

  async function saveDossier() {
    if (!selected) return;
    const playerId = playerIdMap.get(selected);
    if (!playerId) return;

    dossierSaving = true;
    dossierSaveError = null;
    dossierSaved = false;

    const tags = draftTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/players/${playerId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: draftNotes || null, tags }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Save failed (${res.status})`);
      }
      dossier = await res.json();
      draftNotes = dossier?.notes ?? '';
      draftTags = dossier?.tags.join(', ') ?? '';
      dossierSaved = true;
      setTimeout(() => { dossierSaved = false; }, 2000);
    } catch (err) {
      dossierSaveError = err instanceof Error ? err.message : 'Save failed';
    } finally {
      dossierSaving = false;
    }
  }

  async function generateFingerprint() {
    if (!selected) return;
    const playerId = playerIdMap.get(selected);
    if (!playerId) return;

    fingerprintLoading = true;
    fingerprintError = null;

    try {
      const res = await fetch(`/api/players/${playerId}/fingerprint`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Fingerprint failed (${res.status})`);
      }
      const result = (await res.json()) as FingerprintResult;
      fingerprintData = result.fingerprint;
      fingerprintProvenance = {
        model: result.model,
        cost_usd: result.cost_usd,
        generated_at: result.generated_at,
      };
    } catch (err) {
      fingerprintError = err instanceof Error ? err.message : 'Fingerprint failed';
    } finally {
      fingerprintLoading = false;
    }
  }

  async function runVoteProbe(forceRegen = false) {
    if (!selected) return;
    const playerId = playerIdMap.get(selected);
    if (!playerId) return;
    if (!probeSongTitle.trim() || !probeSongArtist.trim()) return;

    const isCustom = probeThemeKey === '__custom__';
    const probeRound = isCustom ? null : openRoundsById.get(probeThemeKey);
    const themeName = probeRound ? probeRound.name : (isCustom ? probeCustomThemeName.trim() : '');
    const themeDesc = probeRound
      ? (probeRound.description ?? probeRound.name)
      : (isCustom ? (probeCustomThemeDesc.trim() || probeCustomThemeName.trim()) : '');
    if (!themeName) return;

    probeLoading = true;
    probeError = null;
    probeResult = null;

    try {
      const body: Record<string, unknown> = {
        song: {
          title: probeSongTitle.trim(),
          artist: probeSongArtist.trim(),
          ...(probeSongUrl.trim() ? { spotify_url: probeSongUrl.trim() } : {}),
        },
        theme: { name: themeName, description: themeDesc },
        ...(forceRegen ? { forceRegen: true } : {}),
      };
      const res = await fetch(`/api/players/${playerId}/vote-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Probe failed (${res.status})`);
      }
      probeResult = (await res.json()) as VoteProbeResult;
    } catch (err) {
      probeError = err instanceof Error ? err.message : 'Probe failed';
    } finally {
      probeLoading = false;
    }
  }

  async function runPredict(forceRegen = false) {
    if (!selected) return;
    const playerId = playerIdMap.get(selected);
    if (!playerId) return;

    const isCustom = predictThemeKey === '__custom__';
    const predictRound = isCustom ? null : openRoundsById.get(predictThemeKey);
    const themeName = predictRound ? predictRound.name : (isCustom ? predictCustomThemeName.trim() : '');
    const themeDesc = predictRound
      ? (predictRound.description ?? predictRound.name)
      : (isCustom ? (predictCustomThemeDesc.trim() || predictCustomThemeName.trim()) : '');
    if (!themeName) return;

    predictLoading = true;
    predictError = null;
    predictResult = null;

    try {
      const res = await fetch(`/api/players/${playerId}/submission-predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: { name: themeName, description: themeDesc }, ...(forceRegen ? { forceRegen: true } : {}) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Predict failed (${res.status})`);
      }
      predictResult = (await res.json()) as SubmissionPredictResult;
    } catch (err) {
      predictError = err instanceof Error ? err.message : 'Predict failed';
    } finally {
      predictLoading = false;
    }
  }

  // Auto-fetch submission-predict when theme changes — serves cached result instantly if available
  let _predictAutoKey = '';
  $effect(() => {
    const sel = selected;
    const key = predictThemeKey;
    const newKey = `${sel ?? ''}::${key}`;
    if (!key || key === '__custom__' || !sel) { _predictAutoKey = ''; return; }
    if (newKey === _predictAutoKey) return;
    _predictAutoKey = newKey;
    const playerId = playerIdMap.get(sel);
    if (!playerId) return;
    runPredict();
  });

  // PR-11: league-scoped theme picking derived state
  const openRoundsById = $derived(new Map(openRounds.map((r) => [String(r.id), r])));
  const probeLeagues = $derived([...new Set(openRounds.map((r) => r.leagueName))]);
  const filteredProbeRounds = $derived(
    openRounds.filter((r) => !probeLeagueFilter || r.leagueName === probeLeagueFilter),
  );
  const predictLeagues = $derived([...new Set(openRounds.map((r) => r.leagueName))]);
  const filteredPredictRounds = $derived(
    openRounds.filter((r) => !predictLeagueFilter || r.leagueName === predictLeagueFilter),
  );

  const pct = (winRate: number) => `${Math.round(winRate * 100)}%`;

  // Picks ranked by score; overlap rows ranked by score for the viz layer.
  const rankedSongs = (songs: PlayerSong[]) => [...songs].sort((a, b) => b.points - a.points);
  const rankedOverlap = (m: Record<string, number>) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]);

</script>

<div class="space-y-6">
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-1">Player research</h3>
    <p class="text-fg-muted text-sm leading-relaxed">
      Everyone we've played with. Pick a player to read their submissions, win rate, and whose taste they share.
    </p>
  </section>

  <!-- Player picker -->
  <section>
    {#if loading}
      <p class="text-fg-faint text-sm font-mono italic">Loading players…</p>
    {:else if loadError}
      <p class="font-mono text-xs text-warn">{loadError}</p>
    {:else if !players.length}
      <p class="text-fg-faint text-sm font-mono italic">No players yet — once leagues are imported they show up here.</p>
    {:else}
      <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">
        Players [{players.length}]
      </h3>
      <div class="flex flex-wrap gap-2">
        {#each players as p (p.name)}
          {@const isSel = selected === p.name}
          <button
            type="button"
            onclick={() => selectPlayer(p.name)}
            aria-pressed={isSel}
            class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            class:bg-accent={isSel}
            class:text-white={isSel}
            class:border-accent-deep={isSel}
            class:bg-bg-elevated={!isSel}
            class:text-fg-muted={!isSel}
            class:border-border-muted={!isSel}
            class:hover:border-border={!isSel}
          >
            <span class="font-medium whitespace-nowrap">{p.name}</span>
            {#if tasteEng && piOf(p.name) >= 0}
              <span class="inline-block w-[54px]" title={tasteEng.nameOf(piOf(p.name))}>{@html tasteEng.buildChart(piOf(p.name), 54, 18, { chrome: false, nodes: false, sample: 40 })}</span>
            {/if}
            <span class="font-mono text-[10px]" class:text-white={isSel} class:text-fg-faint={!isSel}>
              {p.songsSubmitted}♪ · {pct(p.winRate)}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Per-player panel -->
  {#if selected}
    <section class="bg-bg-elevated border border-accent-deep rounded-xl p-4">
      {#if detailLoading}
        <p class="text-fg-faint text-sm font-mono italic">Loading {selected}…</p>
      {:else if detailError}
        <p class="font-mono text-xs text-warn">{detailError}</p>
      {:else if detail}
        <header class="flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="font-display text-xl font-bold text-fg truncate">{selected}</div>
            <div class="font-mono text-[11px] text-fg-dim mt-0.5">
              {detail.songs.length} {detail.songs.length === 1 ? 'song' : 'songs'} submitted · {pct(detail.winRate)} win rate
            </div>
          </div>
          <button
            type="button"
            onclick={() => selectPlayer(selected!)}
            aria-label="Close player"
            class="flex-shrink-0 font-mono text-fg-faint hover:text-fg text-lg leading-none transition-colors"
          >×</button>
        </header>

        <!-- Sonic Signature — the taste waveform -->
        {#if tasteEng && piOf(selected) >= 0}
          <div class="mt-4">
            <TasteWaveform variant="hero" engine={tasteEng} pi={piOf(selected)} name={selected} sub="taste across all leagues" />
          </div>
        {/if}

        <!-- Taste overlap (viz layer renders ranked bars off this markup) -->
        {#if detail.tasteOverlap && Object.keys(detail.tasteOverlap).length}
          <div class="mt-4 pt-3 border-t border-border-muted">
            <button
              type="button"
              onclick={() => { overlapOpen = !overlapOpen; }}
              class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={overlapOpen}
            >
              <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Taste overlap</h4>
              <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={overlapOpen}>▾</span>
            </button>
            {#if overlapOpen}
              <div class="taste-overlap flex flex-col gap-1 mt-2">
                {#each rankedOverlap(detail.tasteOverlap) as [name, score] (name)}
                  <div
                    class="taste-overlap-row flex items-center gap-3 py-1"
                    data-name={name}
                    data-score={score}
                  >
                    <span class="flex-1 min-w-0 font-mono text-[11px] text-fg-muted truncate">{name}</span>
                    <span class="flex-shrink-0 font-mono text-xs tabular-nums text-accent w-12 text-right">{pct(score)}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Dossier (sprint-28) — only for players linked to the players table -->
        {#if playerIdMap.has(selected!)}
          <div class="mt-4 pt-3 border-t border-border-muted">
            <button
              type="button"
              onclick={() => { dossierOpen = !dossierOpen; }}
              class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={dossierOpen}
            >
              <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Dossier</h4>
              <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={dossierOpen}>▾</span>
            </button>

            {#if dossierOpen}
              <div class="mt-3 flex flex-col gap-3">
                {#if dossierLoading}
                  <p class="font-mono text-xs text-fg-faint italic">Loading dossier…</p>
                {:else if dossierError}
                  <p class="font-mono text-xs text-warn">{dossierError}</p>
                {:else}
                  <!-- Notes -->
                  <div class="flex flex-col gap-1">
                    <label for="dossier-notes" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Notes</label>
                    <textarea
                      id="dossier-notes"
                      bind:value={draftNotes}
                      rows={4}
                      placeholder="Freeform context about this player's taste…"
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono resize-y focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    ></textarea>
                  </div>

                  <!-- Tags -->
                  <div class="flex flex-col gap-1">
                    <label for="dossier-tags" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Tags <span class="normal-case">(comma-separated)</span></label>
                    <input
                      id="dossier-tags"
                      type="text"
                      bind:value={draftTags}
                      placeholder="indie, 80s, synth-pop"
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                    {#if dossier?.tags.length}
                      <div class="flex flex-wrap gap-1 mt-1">
                        {#each dossier.tags as tag (tag)}
                          <span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono text-[10px]">{tag}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <!-- Save row -->
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      onclick={saveDossier}
                      disabled={dossierSaving}
                      class="px-3 py-1.5 rounded-lg border border-accent text-accent font-mono text-xs transition-colors hover:bg-accent hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      {dossierSaving ? 'Saving…' : 'Save'}
                    </button>
                    {#if dossierSaved}
                      <span class="font-mono text-xs text-fg-faint">Saved ✓</span>
                    {/if}
                    {#if dossierSaveError}
                      <span class="font-mono text-xs text-warn">{dossierSaveError}</span>
                    {/if}
                    {#if dossier?.updated_at}
                      <span class="font-mono text-[10px] text-fg-faint ml-auto">
                        last saved {new Date(dossier.updated_at + 'Z').toLocaleDateString()}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Taste Fingerprint (sprint-28) -->
          <div class="mt-4 pt-3 border-t border-border-muted">
            <button
              type="button"
              onclick={() => { fingerprintOpen = !fingerprintOpen; }}
              class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={fingerprintOpen}
            >
              <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Taste Fingerprint</h4>
              <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={fingerprintOpen}>▾</span>
            </button>

            {#if fingerprintOpen}
              <div class="mt-3 flex flex-col gap-3">
                <!-- Generate / Regenerate row -->
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    onclick={generateFingerprint}
                    disabled={fingerprintLoading}
                    class="px-3 py-1.5 rounded-lg border border-accent text-accent font-mono text-xs transition-colors hover:bg-accent hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    {fingerprintLoading ? 'Generating…' : fingerprintData ? 'Regenerate' : 'Generate'}
                  </button>
                  {#if fingerprintError}
                    <span class="font-mono text-xs text-warn">{fingerprintError}</span>
                  {/if}
                </div>

                {#if fingerprintData}
                  <!-- Signature artists -->
                  {#if fingerprintData.signature_artists.length}
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Signature Artists</span>
                      <div class="flex flex-wrap gap-1">
                        {#each fingerprintData.signature_artists as artist (artist)}
                          <span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono text-[10px]">{artist}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <!-- Genres -->
                  {#if fingerprintData.genres.length}
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Genres</span>
                      <div class="flex flex-wrap gap-1">
                        {#each fingerprintData.genres as genre (genre)}
                          <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{genre}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <!-- Eras -->
                  {#if fingerprintData.eras.length}
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Eras</span>
                      <div class="flex flex-wrap gap-1">
                        {#each fingerprintData.eras as era (era)}
                          <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{era}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <!-- Rewards / Punishes -->
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Rewards</span>
                      <ul class="flex flex-col gap-0.5">
                        {#each fingerprintData.rewards as r (r)}
                          <li class="font-mono text-[11px] text-fg-muted flex items-start gap-1">
                            <span class="text-accent shrink-0 mt-0.5">↑</span>{r}
                          </li>
                        {/each}
                      </ul>
                    </div>
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Punishes</span>
                      <ul class="flex flex-col gap-0.5">
                        {#each fingerprintData.punishes as p (p)}
                          <li class="font-mono text-[11px] text-fg-muted flex items-start gap-1">
                            <span class="text-warn shrink-0 mt-0.5">↓</span>{p}
                          </li>
                        {/each}
                      </ul>
                    </div>
                  </div>

                  <!-- Summary -->
                  <div class="flex flex-col gap-1">
                    <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Summary</span>
                    <p class="text-sm text-fg leading-relaxed">{fingerprintData.summary}</p>
                  </div>

                  <!-- Provenance stamp -->
                  {#if fingerprintProvenance}
                    <div class="flex items-center gap-2 pt-1 border-t border-border-muted">
                      <span class="font-mono text-[10px] text-fg-faint truncate">
                        {fingerprintProvenance.model} · ${fingerprintProvenance.cost_usd.toFixed(4)} · {new Date(fingerprintProvenance.generated_at).toLocaleDateString()}
                      </span>
                      <span class="ml-auto shrink-0 font-mono text-[10px] rounded-full px-1.5 py-0.5 bg-bg border border-border-muted text-fg-faint capitalize">{fingerprintData.confidence}</span>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>

          <!-- Vote Probe (sprint-28) -->
          <div class="mt-4 pt-3 border-t border-border-muted">
            <button
              type="button"
              onclick={() => { probeOpen = !probeOpen; }}
              class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={probeOpen}
            >
              <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Vote Probe</h4>
              <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={probeOpen}>▾</span>
            </button>

            {#if probeOpen}
              <div class="mt-3 flex flex-col gap-3">
                <!-- Song fields -->
                <div class="flex flex-col gap-2">
                  <div class="flex flex-col gap-1">
                    <label for="probe-title" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Song Title <span class="text-warn">*</span></label>
                    <input
                      id="probe-title"
                      type="text"
                      bind:value={probeSongTitle}
                      placeholder="e.g. Running Up That Hill"
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label for="probe-artist" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Artist <span class="text-warn">*</span></label>
                    <input
                      id="probe-artist"
                      type="text"
                      bind:value={probeSongArtist}
                      placeholder="e.g. Kate Bush"
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label for="probe-url" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Spotify URL <span class="normal-case text-fg-faint">(optional)</span></label>
                    <input
                      id="probe-url"
                      type="url"
                      bind:value={probeSongUrl}
                      placeholder="https://open.spotify.com/track/…"
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                  <!-- Theme dropdown (PR-11: league-scoped) -->
                  <div class="flex flex-col gap-1">
                    <label for="probe-theme" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Theme <span class="text-warn">*</span></label>
                    {#if probeLeagues.length > 1}
                      <div class="flex flex-wrap gap-1 mb-1">
                        <button
                          type="button"
                          onclick={() => { probeLeagueFilter = null; }}
                          class="px-2 py-0.5 rounded-full font-mono text-[10px] border transition-colors focus:outline-none"
                          class:border-accent={probeLeagueFilter === null}
                          class:text-accent={probeLeagueFilter === null}
                          class:bg-accent={probeLeagueFilter === null}
                          class:text-white={probeLeagueFilter === null}
                          class:border-border-muted={probeLeagueFilter !== null}
                          class:text-fg-faint={probeLeagueFilter !== null}
                        >All</button>
                        {#each probeLeagues as league (league)}
                          <button
                            type="button"
                            onclick={() => { probeLeagueFilter = probeLeagueFilter === league ? null : league; }}
                            class="px-2 py-0.5 rounded-full font-mono text-[10px] border transition-colors focus:outline-none"
                            class:border-accent={probeLeagueFilter === league}
                            class:text-white={probeLeagueFilter === league}
                            class:bg-accent={probeLeagueFilter === league}
                            class:border-border-muted={probeLeagueFilter !== league}
                            class:text-fg-faint={probeLeagueFilter !== league}
                          >{league}</button>
                        {/each}
                      </div>
                    {/if}
                    <select
                      id="probe-theme"
                      bind:value={probeThemeKey}
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      <option value="">— select a theme —</option>
                      {#each filteredProbeRounds as r (r.id)}
                        <option value={String(r.id)}>{r.description ?? r.name}</option>
                      {/each}
                      <option value="__custom__">Custom / freeform…</option>
                    </select>
                  </div>
                  <!-- Custom theme freeform -->
                  {#if probeThemeKey === '__custom__'}
                    <div class="flex flex-col gap-2 pl-3 border-l-2 border-border-muted">
                      <div class="flex flex-col gap-1">
                        <label for="probe-custom-name" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Theme Name <span class="text-warn">*</span></label>
                        <input
                          id="probe-custom-name"
                          type="text"
                          bind:value={probeCustomThemeName}
                          placeholder="e.g. Songs with a color in the title"
                          class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label for="probe-custom-desc" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Description <span class="normal-case text-fg-faint">(optional)</span></label>
                        <input
                          id="probe-custom-desc"
                          type="text"
                          bind:value={probeCustomThemeDesc}
                          placeholder="More context about the theme…"
                          class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Probe button -->
                <div class="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onclick={() => runVoteProbe()}
                    disabled={probeLoading || !probeSongTitle.trim() || !probeSongArtist.trim() || !probeThemeKey || (probeThemeKey === '__custom__' && !probeCustomThemeName.trim())}
                    class="px-3 py-1.5 rounded-lg border border-accent text-accent font-mono text-xs transition-colors hover:bg-accent hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    {probeLoading ? 'Probing…' : 'Probe'}
                  </button>
                  {#if probeResult}
                    <button
                      type="button"
                      onclick={() => runVoteProbe(true)}
                      disabled={probeLoading}
                      class="px-3 py-1.5 rounded-lg border border-border-muted text-fg-faint font-mono text-xs transition-colors hover:border-border hover:text-fg disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >Regenerate</button>
                  {/if}
                  {#if probeError}
                    <span class="font-mono text-xs text-warn">{probeError}</span>
                  {/if}
                </div>

                <!-- SAS result -->
                {#if probeResult}
                  <div class="flex flex-col gap-3 pt-2 border-t border-border-muted">
                    <!-- Likelihood gauge -->
                    <div class="flex flex-col gap-1">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Upvote Likelihood</span>
                        <span class="font-mono text-sm font-bold text-accent">{probeResult.upvote_likelihood}%</span>
                      </div>
                      <div class="h-2 w-full rounded-full bg-bg border border-border-muted overflow-hidden">
                        <div
                          class="h-full rounded-full bg-accent transition-all"
                          style="width: {probeResult.upvote_likelihood}%"
                        ></div>
                      </div>
                    </div>

                    <!-- Expected points + confidence -->
                    <div class="flex items-center gap-4">
                      <div class="flex flex-col gap-0.5">
                        <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Expected pts</span>
                        <span class="font-mono text-lg font-bold text-fg tabular-nums">{probeResult.expected_points}</span>
                      </div>
                      <span class="font-mono text-[10px] rounded-full px-1.5 py-0.5 bg-bg border border-border-muted text-fg-faint capitalize self-end mb-1">{probeResult.confidence}</span>
                    </div>

                    <!-- Reasoning -->
                    <div class="flex flex-col gap-1">
                      <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Reasoning</span>
                      <p class="text-sm text-fg leading-relaxed">{probeResult.reasoning}</p>
                    </div>

                    <!-- Signals -->
                    {#if probeResult.signals.length}
                      <div class="flex flex-col gap-1">
                        <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Signals</span>
                        <ul class="flex flex-col gap-1">
                          {#each probeResult.signals as signal (signal)}
                            <li class="font-mono text-[11px] text-fg-muted flex items-start gap-1.5">
                              <span class="text-accent shrink-0 mt-0.5">·</span>{signal}
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}

                    <!-- Provenance stamp -->
                    <div class="flex items-center gap-2 pt-1 border-t border-border-muted">
                      <span class="font-mono text-[10px] text-fg-faint truncate">
                        generated {new Date(probeResult.generated_at).toLocaleDateString()} · {probeResult.model} · ${probeResult.cost_usd.toFixed(4)}
                      </span>
                      {#if probeResult.cache_hit}
                        <span class="ml-auto shrink-0 font-mono text-[10px] rounded-full px-1.5 py-0.5 bg-bg border border-border-muted text-fg-faint">cached</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Submission Predictor (sprint-29) -->
          <div class="mt-4 pt-3 border-t border-border-muted">
            <button
              type="button"
              onclick={() => { predictOpen = !predictOpen; }}
              class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-expanded={predictOpen}
            >
              <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Submission Predictor</h4>
              <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={predictOpen}>▾</span>
            </button>

            {#if predictOpen}
              <div class="mt-3 flex flex-col gap-3">
                <!-- Theme picker (PR-11: league-scoped) -->
                <div class="flex flex-col gap-2">
                  <div class="flex flex-col gap-1">
                    <label for="predict-theme" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Theme <span class="text-warn">*</span></label>
                    {#if predictLeagues.length > 1}
                      <div class="flex flex-wrap gap-1 mb-1">
                        <button
                          type="button"
                          onclick={() => { predictLeagueFilter = null; }}
                          class="px-2 py-0.5 rounded-full font-mono text-[10px] border transition-colors focus:outline-none"
                          class:border-accent={predictLeagueFilter === null}
                          class:text-accent={predictLeagueFilter === null}
                          class:bg-accent={predictLeagueFilter === null}
                          class:text-white={predictLeagueFilter === null}
                          class:border-border-muted={predictLeagueFilter !== null}
                          class:text-fg-faint={predictLeagueFilter !== null}
                        >All</button>
                        {#each predictLeagues as league (league)}
                          <button
                            type="button"
                            onclick={() => { predictLeagueFilter = predictLeagueFilter === league ? null : league; }}
                            class="px-2 py-0.5 rounded-full font-mono text-[10px] border transition-colors focus:outline-none"
                            class:border-accent={predictLeagueFilter === league}
                            class:text-white={predictLeagueFilter === league}
                            class:bg-accent={predictLeagueFilter === league}
                            class:border-border-muted={predictLeagueFilter !== league}
                            class:text-fg-faint={predictLeagueFilter !== league}
                          >{league}</button>
                        {/each}
                      </div>
                    {/if}
                    <select
                      id="predict-theme"
                      bind:value={predictThemeKey}
                      class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      <option value="">— select a theme —</option>
                      {#each filteredPredictRounds as r (r.id)}
                        <option value={String(r.id)}>{r.description ?? r.name}</option>
                      {/each}
                      <option value="__custom__">Custom / freeform…</option>
                    </select>
                  </div>
                  <!-- Custom theme freeform -->
                  {#if predictThemeKey === '__custom__'}
                    <div class="flex flex-col gap-2 pl-3 border-l-2 border-border-muted">
                      <div class="flex flex-col gap-1">
                        <label for="predict-custom-name" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Theme Name <span class="text-warn">*</span></label>
                        <input
                          id="predict-custom-name"
                          type="text"
                          bind:value={predictCustomThemeName}
                          placeholder="e.g. Songs that feel like a road trip"
                          class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </div>
                      <div class="flex flex-col gap-1">
                        <label for="predict-custom-desc" class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Description <span class="normal-case text-fg-faint">(optional)</span></label>
                        <input
                          id="predict-custom-desc"
                          type="text"
                          bind:value={predictCustomThemeDesc}
                          placeholder="More context about the theme…"
                          class="w-full bg-bg border border-border-muted rounded-lg px-3 py-2 text-sm text-fg placeholder:text-fg-faint font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Predict button -->
                <div class="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onclick={() => runPredict()}
                    disabled={predictLoading || !predictThemeKey || (predictThemeKey === '__custom__' && !predictCustomThemeName.trim())}
                    class="px-3 py-1.5 rounded-lg border border-accent text-accent font-mono text-xs transition-colors hover:bg-accent hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    {predictLoading ? 'Predicting…' : 'Predict'}
                  </button>
                  {#if predictResult}
                    <button
                      type="button"
                      onclick={() => runPredict(true)}
                      disabled={predictLoading}
                      class="px-3 py-1.5 rounded-lg border border-border-muted text-fg-faint font-mono text-xs transition-colors hover:border-border hover:text-fg disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >Regenerate</button>
                  {/if}
                  {#if predictError}
                    <span class="font-mono text-xs text-warn">{predictError}</span>
                  {/if}
                </div>

                <!-- Three-part result -->
                {#if predictResult}
                  <div class="flex flex-col gap-4 pt-2 border-t border-border-muted">

                    <!-- (a) Property profile -->
                    <div class="flex flex-col gap-2">
                      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Predicted Profile</span>

                      {#if predictResult.profile.genres.length}
                        <div class="flex flex-col gap-1">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Genres</span>
                          <div class="flex flex-wrap gap-1">
                            {#each predictResult.profile.genres as g (g)}
                              <span class="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono text-[10px]">{g}</span>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      {#if predictResult.profile.artists_or_types.length}
                        <div class="flex flex-col gap-1">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Artists / Types</span>
                          <div class="flex flex-wrap gap-1">
                            {#each predictResult.profile.artists_or_types as a (a)}
                              <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{a}</span>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <div class="flex flex-wrap gap-2">
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Era</span>
                          <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{predictResult.profile.era}</span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Mood / Energy</span>
                          <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{predictResult.profile.mood_energy}</span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Obscurity</span>
                          <span class="px-2 py-0.5 rounded-full bg-bg border border-border-muted text-fg-muted font-mono text-[10px]">{predictResult.profile.obscurity_lean}</span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Comment?</span>
                          <span class="px-2 py-0.5 rounded-full font-mono text-[10px]"
                            class:bg-accent={predictResult.profile.comment_likely}
                            class:text-white={predictResult.profile.comment_likely}
                            class:bg-bg={!predictResult.profile.comment_likely}
                            class:border={!predictResult.profile.comment_likely}
                            class:border-border-muted={!predictResult.profile.comment_likely}
                            class:text-fg-muted={!predictResult.profile.comment_likely}
                          >{predictResult.profile.comment_likely ? 'Yes' : 'No'}</span>
                        </div>
                      </div>

                      <div class="flex flex-col gap-1">
                        <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Rationale</span>
                        <p class="text-sm text-fg leading-relaxed">{predictResult.profile.rationale}</p>
                      </div>
                    </div>

                    <!-- (b) Ranked candidates -->
                    <div class="flex flex-col gap-2">
                      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Candidates</span>
                      <ol class="flex flex-col gap-2">
                        {#each predictResult.candidates as c, i (c.title + '::' + c.artist)}
                          <li class="flex flex-col gap-0.5 pl-3 border-l-2 border-border-muted">
                            <div class="flex items-start gap-2">
                              <span class="font-mono text-[10px] text-fg-faint tabular-nums shrink-0 mt-0.5">{i + 1}.</span>
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                  <span class="font-bold text-fg text-sm">{c.title}</span>
                                  {#if c.spotify_url}
                                    <a
                                      href={c.spotify_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      class="font-mono text-[10px] text-accent hover:underline shrink-0"
                                    >↗ Spotify</a>
                                  {/if}
                                </div>
                                <span class="font-mono text-[11px] text-fg-dim">{c.artist}</span>
                                <p class="font-mono text-[11px] text-fg-muted mt-0.5">{c.why}</p>
                              </div>
                            </div>
                          </li>
                        {/each}
                      </ol>
                    </div>

                    <!-- (c) Final prediction (highlighted) -->
                    <div class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-[10px] tracking-widest uppercase text-accent flex-1">Predicted Pick</span>
                        <span class="font-mono text-[10px] rounded-full px-1.5 py-0.5 bg-bg border border-border-muted text-fg-faint capitalize">{predictResult.prediction.confidence}</span>
                      </div>

                      <div class="flex items-start gap-3">
                        {#if predictResult.prediction.album_art_url}
                          <img
                            src={predictResult.prediction.album_art_url}
                            alt="album art"
                            class="w-12 h-12 rounded object-cover shrink-0"
                          />
                        {/if}
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-bold text-fg text-base">{predictResult.prediction.title}</span>
                            {#if predictResult.prediction.spotify_url}
                              <a
                                href={predictResult.prediction.spotify_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="font-mono text-[10px] text-accent hover:underline shrink-0"
                              >↗ Spotify</a>
                            {/if}
                          </div>
                          <span class="font-mono text-[11px] text-fg-dim">{predictResult.prediction.artist}</span>
                        </div>
                      </div>

                      <div class="flex flex-col gap-1">
                        <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Why this pick</span>
                        <p class="text-sm text-fg leading-relaxed">{predictResult.prediction.detail}</p>
                      </div>

                      {#if predictResult.prediction.similar_past_picks.length}
                        <div class="flex flex-col gap-1">
                          <span class="font-mono text-[10px] tracking-wide uppercase text-fg-faint">Similar past picks</span>
                          <ul class="flex flex-col gap-1">
                            {#each predictResult.prediction.similar_past_picks as pick (pick.title + '::' + pick.round)}
                              <li class="font-mono text-[11px] text-fg-muted flex items-start gap-1.5">
                                <span class="text-accent shrink-0 mt-0.5">·</span>
                                <span>
                                  <span class="text-fg font-medium">{pick.title}</span>
                                  {' '}by {pick.artist}
                                  {#if pick.round}
                                    <span class="text-fg-faint"> · {pick.round}</span>
                                  {/if}
                                  {#if pick.similarity}
                                    <span class="text-fg-faint"> — {pick.similarity}</span>
                                  {/if}
                                </span>
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/if}
                    </div>

                    <!-- Provenance stamp -->
                    <div class="flex items-center gap-2 pt-1 border-t border-border-muted">
                      <span class="font-mono text-[10px] text-fg-faint truncate">
                        generated {new Date(predictResult.generated_at).toLocaleDateString()} · {predictResult.model} · ${predictResult.cost_usd.toFixed(4)}
                      </span>
                      {#if predictResult.cache_hit}
                        <span class="ml-auto shrink-0 font-mono text-[10px] rounded-full px-1.5 py-0.5 bg-bg border border-border-muted text-fg-faint">cached</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Songs submitted (PR-2 — moved to bottom; collapsible per PR-1) -->
        <div class="mt-4 pt-3 border-t border-border-muted">
          <button
            type="button"
            onclick={() => { songsOpen = !songsOpen; }}
            class="flex items-center gap-2 w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-expanded={songsOpen}
          >
            <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint flex-1">Songs submitted</h4>
            <span class="font-mono text-[10px] text-fg-faint transition-transform" class:rotate-180={songsOpen}>▾</span>
          </button>
          {#if songsOpen}
            <div class="mt-2">
              {#if detail.songs.length}
                <ul class="flex flex-col gap-2">
                  {#each rankedSongs(detail.songs) as s, i (s.round + '::' + s.title)}
                    <li class="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-border-muted bg-bg-elevated hover:border-border transition-colors">
                      <span class="shrink-0 font-mono text-[11px] text-fg-faint tabular-nums w-5 text-right">{i + 1}</span>
                      <span class="flex-1 min-w-0">
                        <span class="block font-bold text-fg text-sm leading-snug truncate">{s.title}</span>
                        <span class="block font-mono text-[11px] text-fg-dim truncate">{s.artist}</span>
                      </span>
                      <span class="shrink-0 font-mono text-[10px] text-fg-faint bg-bg border border-border-muted rounded-full px-2 py-0.5 truncate max-w-[7rem]">{s.round}</span>
                      <span class="shrink-0 font-display font-bold tabular-nums text-accent text-sm w-8 text-right">{s.points}</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="text-fg-faint text-sm font-mono italic">No songs recorded.</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
