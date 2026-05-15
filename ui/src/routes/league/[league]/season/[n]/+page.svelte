<script lang="ts">
  import type { PageData } from './$types.js';
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';

  let { data }: { data: PageData } = $props();

  type Round = (typeof data.rounds)[number];

  function durationUntil(iso: string | null): string | null {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    const ms = ts - Date.now();
    if (ms <= 0) return null;
    const totalH = Math.floor(ms / 3_600_000);
    if (totalH >= 24) return `${Math.floor(totalH / 24)}D ${totalH % 24}H`;
    if (totalH >= 1) return `${totalH}H`;
    return `${Math.max(1, Math.floor(ms / 60_000))}M`;
  }

  type Phase = 'submissions' | 'voting' | 'review' | 'archived';
  function phaseFor(r: Round): { phase: Phase; duration: string } | null {
    const sub = durationUntil(r.submissionDeadline);
    if (sub) return { phase: 'submissions', duration: sub };
    const vote = durationUntil(r.votingDeadline);
    if (vote) return { phase: 'voting', duration: vote };
    return null;
  }

  function isActive(r: Round): boolean {
    return phaseFor(r) !== null;
  }

  const sortedRounds = $derived.by(() => {
    const active = data.rounds.filter(isActive).sort((a, b) => {
      const ad = a.submissionDeadline ?? a.votingDeadline ?? '';
      const bd = b.submissionDeadline ?? b.votingDeadline ?? '';
      return ad.localeCompare(bd);
    });
    const archived = data.rounds.filter((r) => !isActive(r)).sort((a, b) => b.id - a.id);
    return { active, archived };
  });
</script>

<svelte:head><title>{data.league.name} S{data.season.seasonNumber} · music-league-bot</title></svelte:head>

<!-- Page header / breadcrumb -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3 truncate">
    <a href="/" class="hover:text-accent transition-colors">music-league-bot</a>
    <span aria-hidden="true"> · </span>
    <span>{data.league.slug}</span>
    <span aria-hidden="true"> · </span>
    <span>season {data.season.seasonNumber}</span>
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">
    {data.league.name} <span class="text-fg-dim">S{data.season.seasonNumber}</span>
  </h1>
  <p class="text-fg-muted max-w-2xl">
    {#if data.rounds.length === 0}
      No rounds imported yet. Upload an export ZIP in Settings.
    {:else}
      {data.rounds.length} round{data.rounds.length === 1 ? '' : 's'}.
      {#if sortedRounds.active.length > 0}
        Active rounds are highlighted; archived rounds sit below.
      {:else}
        All rounds archived.
      {/if}
    {/if}
  </p>
</div>

{#snippet roundCard(r: Round, archived: boolean)}
  {@const p = phaseFor(r)}
  <a
    href="/league/{data.league.slug}/season/{data.season.seasonNumber}/round/{r.id}"
    class="block bg-surface border border-border-muted hover:border-accent-deep rounded-xl p-5 transition-colors group"
  >
    <div class="mb-3 h-5">
      {#if p}
        <DeadlineChip phase={p.phase} duration={p.duration} />
      {:else}
        <StatusChip label="ARCHIVED" tone="muted" />
      {/if}
    </div>
    <div class="font-bold text-fg group-hover:text-accent transition-colors line-clamp-2">
      {r.name}
    </div>
    {#if r.description}
      <div class="text-fg-muted text-sm mt-1 line-clamp-2">{r.description}</div>
    {/if}
    <div class="font-mono text-[11px] text-fg-dim mt-3 truncate">
      <!-- TODO: real member count once a competitors-per-round loader exists; using song count as proxy. -->
      r-{r.id} · {r.songCount} submission{r.songCount === 1 ? '' : 's'}
    </div>
    {#if r.researchCount > 0}
      <div class="font-mono text-[11px] text-accent mt-1 truncate">
        {r.researchCount} in research
      </div>
    {/if}
  </a>
{/snippet}

{#if sortedRounds.active.length > 0}
  <section class="mb-8 bg-surface border-l-4 border-accent rounded-r-xl p-6">
    <header class="flex items-start gap-4 mb-5">
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-bold text-fg">Active rounds</h2>
        <p class="text-fg-muted text-sm mt-0.5">Submissions or votes still open.</p>
      </div>
      <StatusChip label={`${sortedRounds.active.length} OPEN`} tone="accent" />
    </header>
    <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {#each sortedRounds.active as r (r.id)}
        {@render roundCard(r, false)}
      {/each}
    </div>
  </section>
{/if}

{#if sortedRounds.archived.length > 0}
  <section class="bg-surface border border-border-muted rounded-xl p-6">
    <header class="flex items-start gap-4 mb-5">
      <div class="flex-1 min-w-0">
        <h2 class="text-xl font-bold text-fg">Archived rounds</h2>
        <p class="text-fg-muted text-sm mt-0.5">
          {sortedRounds.archived.length} past round{sortedRounds.archived.length === 1 ? '' : 's'}, newest first.
        </p>
      </div>
    </header>
    <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {#each sortedRounds.archived as r (r.id)}
        {@render roundCard(r, true)}
      {/each}
    </div>
  </section>
{/if}
