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
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let players = $state<PlayerSummary[]>([]);
  // name → player_id from /api/players (only players in the players table)
  let playerIdMap = $state<Map<string, number>>(new Map());

  let selected = $state<string | null>(null);
  let detail = $state<PlayerDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);

  // Dossier state
  let dossier = $state<DossierProfile | null>(null);
  let dossierLoading = $state(false);
  let dossierError = $state<string | null>(null);
  let dossierOpen = $state(true);
  let draftNotes = $state('');
  let draftTags = $state('');
  let dossierSaving = $state(false);
  let dossierSaveError = $state<string | null>(null);
  let dossierSaved = $state(false);

  onMount(async () => {
    try {
      const [histRes, playersRes] = await Promise.all([
        fetch('/api/history/players'),
        fetch('/api/players'),
      ]);
      if (!histRes.ok) throw new Error(`Failed to load players (${histRes.status})`);
      players = await histRes.json();
      if (playersRes.ok) {
        const allPlayers = (await playersRes.json()) as { id: number; name: string }[];
        playerIdMap = new Map(allPlayers.map((p) => [p.name, p.id]));
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

        <!-- Songs submitted -->
        <div class="mt-4">
          <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Songs submitted</h4>
          {#if detail.songs.length}
            <ul class="flex flex-col divide-y divide-border-muted">
              {#each rankedSongs(detail.songs) as s (s.round + '::' + s.title)}
                <li class="flex items-center gap-3 py-2 first:pt-0">
                  <span class="flex-1 min-w-0">
                    <span class="block font-bold text-fg text-sm truncate">{s.title}</span>
                    <span class="block font-mono text-[11px] text-fg-dim truncate">{s.artist} · {s.round}</span>
                  </span>
                  <span class="flex-shrink-0 font-mono text-xs tabular-nums text-accent w-10 text-right">{s.points}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-fg-faint text-sm font-mono italic">No songs recorded.</p>
          {/if}
        </div>

        <!-- Taste overlap (viz layer renders ranked bars off this markup) -->
        {#if detail.tasteOverlap && Object.keys(detail.tasteOverlap).length}
          <div class="mt-4 pt-3 border-t border-border-muted">
            <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Taste overlap</h4>
            <div class="taste-overlap flex flex-col gap-1">
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
        {/if}
      {/if}
    </section>
  {/if}
</div>
