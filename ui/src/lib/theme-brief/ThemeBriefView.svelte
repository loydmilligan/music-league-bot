<script lang="ts">
  import type { ThemeBrief } from './types.js';
  import { exposureLabel } from './exposureLabel.js';

  let { brief: initialBrief, roundId }: { brief: ThemeBrief | null; roundId: number } = $props();

  let brief = $state(initialBrief);
  let loading = $state(false);

  const ordinalSuffix = (n: number): string => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (n % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  };

  async function generate(force: boolean) {
    loading = true;
    try {
      const res = await fetch(`/api/theme-brief/${roundId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = (await res.json()) as { brief: ThemeBrief };
      brief = data.brief;
    } finally {
      loading = false;
    }
  }
</script>

{#if !brief}
  <button onclick={() => generate(false)} disabled={loading}>
    {loading ? 'Generating…' : 'Generate brief'}
  </button>
{:else}
  <header>
    <h2>{brief.themeTitle}</h2>
    <p>
      {#if brief.firstTime}
        First time for this theme.
      {:else}
        The {brief.runCount}{ordinalSuffix(brief.runCount)} run of this theme.
      {/if}
    </p>
    <button onclick={() => generate(true)} disabled={loading}>
      {loading ? 'Generating…' : 'Regenerate'}
    </button>
  </header>

  {#each brief.matches as run (run.roundId)}
    <section class="run">
      <h3>
        {run.leagueName}
        {run.seasonLabel} — {run.title}
        <span class="scoring">{run.scoring === 'downvotes' ? 'downvotes on' : 'upvote-only'}</span>
        <span class="exactness">{run.exactness}</span>
      </h3>
      <p class="reason">{run.reason}</p>
      <ol class="podium">
        {#each run.podium as s (s.spotifyUri)}
          <li>🏅 {s.title} — {s.artist} <b>{s.points}</b></li>
        {/each}
      </ol>
      {#each run.cellar as s (s.spotifyUri)}
        <div class="cellar">🔻 {s.title} — {s.artist} <b>{s.points}</b></div>
      {/each}
    </section>
  {/each}

  {#if !brief.firstTime}
    <section>
      <h3>Winner DNA</h3>
      <p>{brief.winnerDna}</p>
      <ul class="familiarity">
        {#each brief.familiarity as b (b.key)}
          <li>{b.label}: avg <b>{b.avgPoints}</b> (n={b.n})</li>
        {/each}
      </ul>
    </section>
    <section>
      <h3>Cellar traps</h3>
      <p>{brief.cellarTraps}</p>
    </section>
    <section>
      <h3>What to submit</h3>
      <p>{brief.whatToSubmit}</p>
    </section>
    <section>
      <h3>You've already played</h3>
      <ul>
        {#each brief.alreadyPlayed as e (e.submissionId)}
          <li class:recognizable={e.recognizable}>{e.title} — {e.artist} · {exposureLabel(e)}</li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .recognizable {
    font-weight: 700;
  }
  .cellar {
    opacity: 0.8;
  }
</style>
