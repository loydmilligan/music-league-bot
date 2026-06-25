<!--
  ShortlistH2HPanel — inline king-of-the-hill H2H comparison on /shortlist.
  Uses shortlist songs directly (no research_songs step); assignment of the
  champion to the target league's active round is the final "write" step.
  Mobile (<768px): SongCompare swipe surface. Desktop: side-by-side cards.
  (sprint-25 h2h-league-selector)
-->
<script lang="ts">
  import type { ShortlistSong } from '$lib/types.js';
  import SongCompare from '$lib/song/SongCompare.svelte';

  type Candidate = {
    id: string;
    title: string;
    artist: string;
    score: number;
  };

  const {
    leagueName,
    roundId,
    songs,
    onAssigned,
    onClose,
  } = $props<{
    leagueName: string;
    roundId: number;
    songs: ShortlistSong[];
    onAssigned: (songId: string, roundId: number) => void;
    onClose: () => void;
  }>();

  function totalScore(s: ShortlistSong): number {
    return s.ratingDiscovery + s.ratingThemeFit + s.ratingNostalgia + s.ratingPersonal;
  }

  // Build sorted candidate list once; filtered to rated songs first.
  const initialCandidates: Candidate[] = [...songs]
    .sort((a, b) => totalScore(b) - totalScore(a))
    .map(s => ({ id: s.id, title: s.title, artist: s.artist, score: totalScore(s) }));

  if (initialCandidates.length < 2) {
    // Handled in template — guard here keeps types clean.
  }

  // King-of-the-hill state
  let champion = $state<Candidate | null>(initialCandidates[0] ?? null);
  let queue = $state<Candidate[]>(initialCandidates.slice(1));
  let retired = $state<Candidate[]>([]);
  let matchCount = $state(0);
  let assigning = $state(false);
  let assigned = $state(false);
  let assignError = $state<string | null>(null);

  const challenger = $derived(queue[0] ?? null);
  const isComplete = $derived(queue.length === 0);

  function pick(winner: Candidate, loser: Candidate) {
    retired = [...retired, loser];
    queue = queue.slice(1);
    champion = winner;
    matchCount++;
  }

  async function assignChampion() {
    if (!champion || assigning || assigned) return;
    assigning = true;
    assignError = null;
    try {
      const res = await fetch(`/api/shortlist/${champion.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round_id: roundId }),
      });
      if (!res.ok) throw new Error(`assign failed (${res.status})`);
      assigned = true;
      onAssigned(champion.id, roundId);
    } catch (e) {
      assignError = e instanceof Error ? e.message : 'assign failed';
    } finally {
      assigning = false;
    }
  }

  function scoreBar(score: number): number {
    const max = initialCandidates[0]?.score ?? 1;
    return max > 0 ? Math.min(100, Math.round((score / max) * 100)) : 0;
  }

  // Mobile detection — SongCompare renders below 768px; desktop cards above.
  let isMobile = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    isMobile = mq.matches;
    const handler = (e: MediaQueryListEvent) => { isMobile = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // Mobile winner lands here; then the shared assign UI takes over.
  let mobileWinner = $state<ShortlistSong | null>(null);

  async function assignMobileWinner() {
    if (!mobileWinner || assigning || assigned) return;
    assigning = true;
    assignError = null;
    try {
      const res = await fetch(`/api/shortlist/${mobileWinner.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round_id: roundId }),
      });
      if (!res.ok) throw new Error(`assign failed (${res.status})`);
      assigned = true;
      onAssigned(mobileWinner.id, roundId);
    } catch (e) {
      assignError = e instanceof Error ? e.message : 'assign failed';
    } finally {
      assigning = false;
    }
  }
</script>

{#if isMobile}
  <!-- Mobile path: SongCompare stacked-card surface -->
  {#if mobileWinner}
    <div class="sl-h2h-panel">
      <div class="sl-h2h-header">
        <span class="sl-h2h-league">{leagueName}</span>
        <span class="sl-h2h-title">Your pick</span>
        <button type="button" class="sl-h2h-close" onclick={onClose} aria-label="Close">✕</button>
      </div>
      <div class="sl-h2h-winner">
        <p class="sl-h2h-winner-label">Winner</p>
        <p class="sl-h2h-winner-artist">{mobileWinner.artist}</p>
        <p class="sl-h2h-winner-title">{mobileWinner.title}</p>
        <div class="sl-h2h-winner-actions">
          {#if assigned}
            <span class="sl-h2h-assigned-badge">✓ Assigned to {leagueName}</span>
          {:else}
            <button
              type="button"
              class="sl-h2h-btn-assign"
              disabled={assigning}
              onclick={assignMobileWinner}
            >{assigning ? '…' : `↗ Assign to ${leagueName} round`}</button>
          {/if}
          {#if assignError}<span class="sl-h2h-err">{assignError}</span>{/if}
          <button type="button" class="sl-h2h-btn-ghost" onclick={onClose}>
            {assigned ? 'Close' : 'Skip & close'}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="sl-mobile-compare">
      <SongCompare
        {leagueName}
        {songs}
        onComplete={(winner) => { mobileWinner = winner; }}
        {onClose}
      />
    </div>
  {/if}
{:else}

<div class="sl-h2h-panel">
  <div class="sl-h2h-header">
    <span class="sl-h2h-league">{leagueName}</span>
    <span class="sl-h2h-title">Head-to-head · pick your submission</span>
    <button type="button" class="sl-h2h-close" onclick={onClose} aria-label="Close H2H panel">✕</button>
  </div>

  {#if initialCandidates.length < 2}
    <div class="sl-h2h-empty">
      <p>Need at least 2 shortlisted songs to run H2H. Add more songs to your shortlist first.</p>
      <button type="button" class="sl-h2h-btn-ghost" onclick={onClose}>Close</button>
    </div>
  {:else if isComplete && champion}
    <div class="sl-h2h-winner">
      <p class="sl-h2h-winner-label">Winner — {matchCount} match{matchCount === 1 ? '' : 'es'}</p>
      <p class="sl-h2h-winner-artist">{champion.artist}</p>
      <p class="sl-h2h-winner-title">{champion.title}</p>
      <div class="sl-h2h-winner-actions">
        {#if assigned}
          <span class="sl-h2h-assigned-badge">✓ Assigned to {leagueName}</span>
        {:else}
          <button
            type="button"
            class="sl-h2h-btn-assign"
            disabled={assigning}
            onclick={assignChampion}
          >{assigning ? '…' : `↗ Assign to ${leagueName} round`}</button>
        {/if}
        {#if assignError}
          <span class="sl-h2h-err">{assignError}</span>
        {/if}
        <button type="button" class="sl-h2h-btn-ghost" onclick={onClose}>
          {assigned ? 'Close' : 'Skip & close'}
        </button>
      </div>
      {#if retired.length > 0}
        <div class="sl-h2h-retired">
          <p class="sl-h2h-retired-label">Retired</p>
          {#each retired as s (s.id)}
            <div class="sl-h2h-retired-row">
              <span class="sl-h2h-retired-artist">{s.artist}</span>
              <span class="sl-h2h-retired-title"> — {s.title}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if champion && challenger}
    <div class="sl-h2h-match">
      <p class="sl-h2h-match-count">Match {matchCount + 1} of ~{initialCandidates.length - 1}</p>
      <div class="sl-h2h-cards">
        <div class="sl-h2h-card sl-h2h-card--champ">
          <span class="sl-h2h-card-role">Holding lane</span>
          <p class="sl-h2h-card-artist">{champion.artist}</p>
          <p class="sl-h2h-card-title">{champion.title}</p>
          <div class="sl-h2h-card-bar">
            <div class="sl-h2h-card-bar-fill" style="width: {scoreBar(champion.score)}%"></div>
          </div>
          <span class="sl-h2h-card-score">{champion.score.toFixed(1)}</span>
          <button
            type="button"
            class="sl-h2h-card-pick"
            onclick={() => pick(champion!, challenger!)}
          >Pick this one</button>
        </div>
        <div class="sl-h2h-vs">vs</div>
        <div class="sl-h2h-card sl-h2h-card--challenger">
          <span class="sl-h2h-card-role">Challenger</span>
          <p class="sl-h2h-card-artist">{challenger.artist}</p>
          <p class="sl-h2h-card-title">{challenger.title}</p>
          <div class="sl-h2h-card-bar">
            <div class="sl-h2h-card-bar-fill" style="width: {scoreBar(challenger.score)}%"></div>
          </div>
          <span class="sl-h2h-card-score">{challenger.score.toFixed(1)}</span>
          <button
            type="button"
            class="sl-h2h-card-pick"
            onclick={() => pick(challenger!, champion!)}
          >Pick this one</button>
        </div>
      </div>
      {#if queue.length > 1}
        <p class="sl-h2h-queue-hint">{queue.length - 1} more challenger{queue.length - 1 === 1 ? '' : 's'} in queue</p>
      {/if}
    </div>
  {/if}
</div>

{/if}<!-- end mobile/desktop branch -->

<style>
  .sl-mobile-compare {
    border: 1px solid var(--mash-pulp, #7fb3ff);
    border-radius: var(--r-3, 8px);
    background: var(--surface-2, #141921);
    margin-bottom: 14px;
    overflow: hidden;
    height: 92dvh;
    display: flex;
    flex-direction: column;
  }

  .sl-h2h-panel {
    border: 1px solid var(--mash-pulp, #7fb3ff);
    border-radius: var(--r-3, 8px);
    background: var(--surface-2, #141921);
    margin-bottom: 14px;
    overflow: hidden;
  }
  .sl-h2h-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--mash-pulp, #7fb3ff) 8%, transparent);
    border-bottom: 1px solid var(--line, #283039);
  }
  .sl-h2h-league {
    font: 700 10px/1 var(--font-mono);
    color: var(--mash-pulp, #7fb3ff);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  }
  .sl-h2h-title {
    font: 600 12px/1 var(--font-body);
    color: var(--fg-muted, #c2cad3);
    flex: 1;
  }
  .sl-h2h-close {
    background: transparent;
    border: none;
    color: var(--fg-quiet, #6b7b8a);
    cursor: pointer;
    font: 700 14px/1 var(--font-mono);
    padding: 2px 6px;
    border-radius: var(--r-1, 3px);
    flex-shrink: 0;
  }
  .sl-h2h-close:hover { color: var(--fg, #f1f4f7); }

  /* Empty state */
  .sl-h2h-empty {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    font: 400 13px/1.5 var(--font-body);
    color: var(--fg-muted, #c2cad3);
  }

  /* Match */
  .sl-h2h-match {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sl-h2h-match-count {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-quiet, #6b7b8a);
  }
  .sl-h2h-cards {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  @media (max-width: 480px) {
    .sl-h2h-cards { flex-direction: column; }
    .sl-h2h-vs { text-align: center; }
  }
  .sl-h2h-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: var(--r-2, 5px);
    border: 1px solid var(--line, #283039);
  }
  .sl-h2h-card--champ { background: var(--surface, #0f1419); border-color: var(--mash-pulp, #7fb3ff); }
  .sl-h2h-card--challenger { background: var(--ink-0, #0a0d12); }
  .sl-h2h-card-role {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-quiet, #6b7b8a);
  }
  .sl-h2h-card--champ .sl-h2h-card-role { color: var(--mash-pulp, #7fb3ff); }
  .sl-h2h-card-artist {
    font: 700 14px/1.2 var(--font-body);
    color: var(--fg, #f1f4f7);
    margin: 0;
  }
  .sl-h2h-card-title {
    font: 400 12px/1.3 var(--font-body);
    color: var(--fg-muted, #c2cad3);
    margin: 0;
  }
  .sl-h2h-card-bar {
    height: 3px;
    background: var(--line, #283039);
    border-radius: 2px;
    overflow: hidden;
    margin: 2px 0;
  }
  .sl-h2h-card-bar-fill {
    height: 100%;
    background: var(--mash-pulp, #7fb3ff);
    border-radius: 2px;
    transition: width 200ms;
  }
  .sl-h2h-card-score {
    font: 700 11px/1 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
  }
  .sl-h2h-card-pick {
    margin-top: auto;
    padding: 7px 12px;
    font: 700 10px/1 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-2, 5px);
    border: 1px solid var(--mash-pulp, #7fb3ff);
    background: transparent;
    color: var(--mash-pulp, #7fb3ff);
    cursor: pointer;
    transition: background 100ms, color 100ms;
  }
  .sl-h2h-card-pick:hover {
    background: color-mix(in srgb, var(--mash-pulp, #7fb3ff) 15%, transparent);
  }
  .sl-h2h-vs {
    display: flex;
    align-items: center;
    font: 700 11px/1 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
    padding: 0 2px;
    flex-shrink: 0;
  }
  .sl-h2h-queue-hint {
    font: 400 11px/1 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
    font-style: italic;
  }

  /* Winner */
  .sl-h2h-winner {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .sl-h2h-winner-label {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--moss, #3fcb8a);
    margin: 0;
  }
  .sl-h2h-winner-artist {
    font: 700 20px/1.2 var(--font-body);
    color: var(--fg, #f1f4f7);
    margin: 0;
  }
  .sl-h2h-winner-title {
    font: 400 15px/1.3 var(--font-body);
    color: var(--fg-muted, #c2cad3);
    margin: 0;
  }
  .sl-h2h-winner-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 8px;
  }
  .sl-h2h-btn-assign {
    padding: 7px 14px;
    font: 700 10px/1 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-2, 5px);
    border: 1px solid var(--moss, #3fcb8a);
    background: transparent;
    color: var(--moss, #3fcb8a);
    cursor: pointer;
    transition: background 100ms;
  }
  .sl-h2h-btn-assign:hover:not(:disabled) {
    background: color-mix(in srgb, var(--moss, #3fcb8a) 12%, transparent);
  }
  .sl-h2h-btn-assign:disabled { opacity: 0.5; cursor: default; }
  .sl-h2h-assigned-badge {
    font: 700 10px/1 var(--font-mono);
    color: var(--moss, #3fcb8a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .sl-h2h-btn-ghost {
    padding: 7px 14px;
    font: 700 10px/1 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-2, 5px);
    border: 1px solid var(--line, #283039);
    background: transparent;
    color: var(--fg-muted, #c2cad3);
    cursor: pointer;
  }
  .sl-h2h-btn-ghost:hover { color: var(--fg, #f1f4f7); border-color: var(--line-strong); }
  .sl-h2h-err {
    font: 400 11px/1 var(--font-mono);
    color: var(--ember, #e0533a);
  }
  .sl-h2h-retired {
    margin-top: 12px;
    border-top: 1px solid var(--line, #283039);
    padding-top: 10px;
    width: 100%;
  }
  .sl-h2h-retired-label {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-quiet, #6b7b8a);
    margin: 0 0 6px;
  }
  .sl-h2h-retired-row {
    font: 400 11px/1.6 var(--font-mono);
    color: var(--fg-quiet, #6b7b8a);
  }
  .sl-h2h-retired-artist { font-weight: 700; }
  .sl-h2h-retired-title { color: var(--fg-faint, #4a5666); }
</style>
