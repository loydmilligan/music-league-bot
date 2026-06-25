<!--
  SongCompare — mobile KOTH comparison surface using mcc-* CSS (song.css).
  Two stacked cards with a VS medallion; tale-of-the-tape rating grid;
  progress dots + tie/undo/next footer.
  Manages KOTH state internally; emits onComplete(winner) when queue is exhausted.
-->
<script lang="ts">
  import type { ShortlistSong } from '$lib/types.js';

  const {
    leagueName,
    songs,
    onComplete,
    onClose,
  } = $props<{
    leagueName: string;
    songs: ShortlistSong[];
    onComplete: (winner: ShortlistSong) => void;
    onClose: () => void;
  }>();

  function totalScore(s: ShortlistSong): number {
    return s.ratingDiscovery + s.ratingThemeFit + s.ratingNostalgia +
           s.ratingPersonal + s.ratingQuality + s.ratingReplayability;
  }

  const initial = [...songs].sort((a, b) => totalScore(b) - totalScore(a));

  let champion = $state<ShortlistSong | null>(initial[0] ?? null);
  let championHistory = $state<ShortlistSong[]>(initial[0] ? [initial[0]] : []);
  let queue = $state<ShortlistSong[]>(initial.slice(1));
  let retired = $state<ShortlistSong[]>([]);
  let matchCount = $state(0);

  const challenger = $derived(queue[0] ?? null);
  const isComplete = $derived(queue.length === 0);
  const totalMatches = initial.length - 1;

  const DIMS = [
    { key: 'ratingDiscovery' as const,     label: 'DISC'  },
    { key: 'ratingThemeFit' as const,      label: 'THEME' },
    { key: 'ratingNostalgia' as const,     label: 'NOS'   },
    { key: 'ratingPersonal' as const,      label: 'PER'   },
    { key: 'ratingQuality' as const,       label: 'QUAL'  },
    { key: 'ratingReplayability' as const, label: 'RPLY'  },
  ];

  function pick(winner: ShortlistSong, loser: ShortlistSong) {
    retired = [...retired, loser];
    queue = queue.slice(1);
    champion = winner;
    championHistory = [...championHistory, winner];
    matchCount++;
  }

  function skipTie() {
    if (!challenger) return;
    retired = [...retired, challenger];
    queue = queue.slice(1);
    matchCount++;
    // champion unchanged
    championHistory = [...championHistory, champion!];
  }

  function undo() {
    if (matchCount === 0 || !champion) return;
    const prevChamp = championHistory[championHistory.length - 2]!;
    const undoneLoser = retired[retired.length - 1]!;

    retired = retired.slice(0, -1);
    championHistory = championHistory.slice(0, -1);
    matchCount--;

    if (champion.id !== prevChamp.id) {
      // Challenger had won last match — put current champ back to queue front
      queue = [champion, ...queue];
      champion = prevChamp;
    } else {
      // Champ held — restore loser (challenger) to queue front
      queue = [undoneLoser, ...queue];
    }
  }
</script>

<div class="mcc-wrap">
  <!-- Header bar -->
  <div class="mcc-bar">
    <div>
      <div class="mcc-bar-eyebrow">{leagueName}</div>
      <div class="mcc-bar-title">Pick your song</div>
      {#if !isComplete && totalMatches > 0}
        <div class="mcc-bar-prog">Match {matchCount + 1} / {totalMatches}</div>
      {/if}
    </div>
    <button type="button" class="mcc-x" onclick={onClose} aria-label="Close">✕</button>
  </div>

  {#if initial.length < 2}
    <div class="mcc-empty">Add at least 2 songs to your shortlist to run H2H.</div>

  {:else if isComplete && champion}
    <!-- Winner state -->
    <div class="mcc-stage">
      <div class="mcc-card win" style="margin-top:6px">
        <div class="mcc-newchamp">Champion</div>
        <div class="mcc-head">
          <div class="mcc-art">
            {#if champion.albumArtUrl}
              <img src={champion.albumArtUrl} alt="" />
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
            {/if}
          </div>
          <div class="mcc-head-text">
            <div class="mcc-title">{champion.title}</div>
            <div class="mcc-artist">{champion.artist}</div>
          </div>
          <div class="mcc-scorebig">
            <div class="n">{totalScore(champion)}</div>
            <div class="d">pts</div>
          </div>
        </div>
        <p class="mcc-winner-note">{matchCount} match{matchCount === 1 ? '' : 'es'} played</p>
      </div>
    </div>
    <div class="mcc-foot">
      <button type="button" class="mcc-tie" onclick={onClose}>Close</button>
      <button type="button" class="mcc-next" onclick={() => champion && onComplete(champion)}>
        ↗ Use this song
      </button>
    </div>

  {:else if champion && challenger}
    <!-- Match state -->
    <div class="mcc-stage">
      <!-- Champion card -->
      <div class="mcc-card champ" style="margin-top:4px">
        <div class="mcc-ribbon">
          Holding
          {#if matchCount > 0}<span class="streak">×{matchCount}</span>{/if}
        </div>
        <div class="mcc-head">
          <div class="mcc-art">
            {#if champion.albumArtUrl}
              <img src={champion.albumArtUrl} alt="" />
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
            {/if}
          </div>
          <div class="mcc-head-text">
            <div class="mcc-title">{champion.title}</div>
            <div class="mcc-artist">{champion.artist}</div>
          </div>
          <div class="mcc-scorebig">
            <div class="n">{totalScore(champion)}</div>
            <div class="d">pts</div>
          </div>
        </div>
        <div class="mcc-tape">
          <div class="mcc-tape-grid">
            {#each DIMS as d}
              {@const cv = champion[d.key]}
              {@const chv = challenger[d.key]}
              <div class="mcc-axis" class:hi={cv > chv}>
                <span class="l">{d.label}</span>
                <span class="v">{cv}</span>
              </div>
            {/each}
          </div>
        </div>
        <button
          type="button"
          class="mcc-pick"
          onclick={() => pick(champion!, challenger!)}
        >Keep this one</button>
      </div>

      <!-- VS medallion -->
      <div class="mcc-vs"><span>VS</span></div>

      <!-- Challenger card -->
      <div class="mcc-card">
        <div class="mcc-head">
          <div class="mcc-art">
            {#if challenger.albumArtUrl}
              <img src={challenger.albumArtUrl} alt="" />
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
            {/if}
          </div>
          <div class="mcc-head-text">
            <div class="mcc-title">{challenger.title}</div>
            <div class="mcc-artist">{challenger.artist}</div>
          </div>
          <div class="mcc-scorebig">
            <div class="n">{totalScore(challenger)}</div>
            <div class="d">pts</div>
          </div>
        </div>
        <div class="mcc-tape">
          <div class="mcc-tape-grid">
            {#each DIMS as d}
              {@const cv = champion[d.key]}
              {@const chv = challenger[d.key]}
              <div class="mcc-axis" class:hi={chv > cv}>
                <span class="l">{d.label}</span>
                <span class="v">{chv}</span>
              </div>
            {/each}
          </div>
        </div>
        <button
          type="button"
          class="mcc-pick"
          onclick={() => pick(challenger!, champion!)}
        >Switch to this</button>
      </div>
    </div>

    <!-- Footer: dots + tie + undo + next (when last match) -->
    <div class="mcc-foot">
      {#if totalMatches <= 12}
        <div class="mcc-dots">
          {#each { length: totalMatches } as _, i}
            <div
              class="mcc-dotp"
              class:done={i < matchCount}
              class:on={i === matchCount}
            ></div>
          {/each}
        </div>
      {:else}
        <span class="mcc-prog-text">{matchCount}/{totalMatches}</span>
      {/if}

      <button type="button" class="mcc-tie" onclick={skipTie}>Tie</button>

      {#if matchCount > 0}
        <button type="button" class="mcc-undo" onclick={undo} aria-label="Undo last pick">↩</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .mcc-x {
    background: none; border: none; color: var(--fg-quiet); cursor: pointer;
    font-size: 15px; padding: 4px 8px; border-radius: var(--r-1); margin-left: auto;
    align-self: flex-start;
  }
  .mcc-x:hover { color: var(--fg); }

  .mcc-empty {
    padding: 28px 18px; color: var(--fg-muted); font-size: 14px; line-height: 1.5;
  }

  .mcc-winner-note {
    font-family: var(--font-mono); font-size: 11px; color: var(--fg-quiet);
    margin: 8px 0 0;
  }

  .mcc-prog-text {
    font-family: var(--font-mono); font-size: 11px; color: var(--fg-quiet);
    letter-spacing: 0.04em;
  }
</style>
