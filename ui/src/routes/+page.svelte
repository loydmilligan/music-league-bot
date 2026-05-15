<script lang="ts">
  import type { PageData } from './$types.js';
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import DotIndicator from '$lib/components/DotIndicator.svelte';

  let { data }: { data: PageData } = $props();

  type ActiveSeason = (typeof data.activeSeasons)[number];

  function durationUntil(iso: string | null): string | null {
    if (!iso) return null;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return null;
    const ms = ts - Date.now();
    if (ms <= 0) return 'OVERDUE';
    const totalH = Math.floor(ms / 3_600_000);
    if (totalH >= 24) return `${Math.floor(totalH / 24)}D ${totalH % 24}H`;
    if (totalH >= 1) return `${totalH}H`;
    return `${Math.max(1, Math.floor(ms / 60_000))}M`;
  }

  type Phase = 'submissions' | 'voting' | 'review' | 'archived';
  function phaseFor(s: ActiveSeason): { phase: Phase; duration: string } | null {
    const r = s.currentRound;
    if (!r) return null;
    const subD = durationUntil(r.submissionDeadline);
    if (subD && subD !== 'OVERDUE') return { phase: 'submissions', duration: subD };
    const voteD = durationUntil(r.votingDeadline);
    if (voteD && voteD !== 'OVERDUE') return { phase: 'voting', duration: voteD };
    return { phase: 'review', duration: '—' };
  }

  // Sort active leagues by soonest deadline first.
  const activeLeagues = $derived(
    [...data.activeSeasons].sort((a, b) => {
      const da = a.currentRound?.submissionDeadline ?? a.currentRound?.votingDeadline ?? null;
      const db = b.currentRound?.submissionDeadline ?? b.currentRound?.votingDeadline ?? null;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return Date.parse(da) - Date.parse(db);
    })
  );

  // Union of every adopted league we can see: active + past. Dedup by slug.
  // TODO: once backend's +layout.server.ts loader lands, switch to page.data.leagues
  // for the canonical full list including idle leagues with no past seasons.
  type LeagueRow = {
    slug: string;
    name: string;
    status: 'active' | 'voting' | 'open' | 'idle';
    sublineMono: string;
    href: string;
    activeSeason?: ActiveSeason;
  };

  const allLeagues = $derived.by<LeagueRow[]>(() => {
    const rows = new Map<string, LeagueRow>();
    for (const s of activeLeagues) {
      const p = phaseFor(s);
      const status: LeagueRow['status'] =
        p?.phase === 'voting' ? 'voting' : p?.phase === 'submissions' ? 'open' : 'active';
      rows.set(s.league.slug, {
        slug: s.league.slug,
        name: s.league.name,
        status,
        sublineMono: s.currentRound
          ? `r-${s.currentRound.id} · ${status}`
          : `s${s.seasonNumber} · active`,
        href: `/league/${s.league.slug}/season/${s.seasonNumber}`,
        activeSeason: s,
      });
    }
    for (const item of data.pastLeagues) {
      if (rows.has(item.league.slug)) continue;
      const lastSeason = item.seasons.at(-1);
      rows.set(item.league.slug, {
        slug: item.league.slug,
        name: item.league.name,
        status: 'idle',
        sublineMono: `${item.totalRounds} rounds · idle`,
        href: lastSeason
          ? `/league/${item.league.slug}/season/${lastSeason.seasonNumber}`
          : `/league/${item.league.slug}`,
      });
    }
    // Active leagues first (sorted by soonest deadline), then idle leagues alphabetical.
    return [...rows.values()].sort((a, b) => {
      const order = { active: 0, open: 0, voting: 0, idle: 1 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.name.localeCompare(b.name);
    });
  });

  const activeCount = $derived(activeLeagues.length);
  const totalLeagues = $derived(allLeagues.length);
</script>

<svelte:head><title>Mash League · music-league-bot</title></svelte:head>

<!-- Page header / breadcrumb -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · overview
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">Mash League</h1>
  <p class="text-fg-muted max-w-2xl">
    {#if totalLeagues > 0}
      {totalLeagues} league{totalLeagues === 1 ? '' : 's'} adopted. Active rounds need attention first; voting
      deadlines bubble up next; idle leagues sit at the bottom where they belong.
    {:else}
      No leagues adopted yet. Drop an export ZIP under <code class="font-mono text-fg">data/&lt;slug&gt;/season-N/</code> and re-scan from Settings.
    {/if}
  </p>
</div>

<!-- Needs you this week -->
<section
  class="mb-8 bg-surface border-l-4 border-accent rounded-r-xl p-6"
>
  <header class="flex items-start gap-4 mb-5">
    <div class="flex-1 min-w-0">
      <h2 class="text-xl font-bold text-fg">Needs you this week</h2>
      <p class="text-fg-muted text-sm mt-0.5">Submissions or votes due in &lt; 4 days.</p>
    </div>
    {#if activeCount > 0}
      <StatusChip label={`${activeCount} OPEN`} tone="accent" />
    {/if}
  </header>

  {#if activeLeagues.length === 0}
    <p class="text-fg-faint font-mono text-sm italic">No active rounds. Quiet week.</p>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each activeLeagues as s (s.league.slug + s.seasonNumber)}
        {@const p = phaseFor(s)}
        <a
          href="/league/{s.league.slug}/season/{s.seasonNumber}"
          class="block bg-bg-elevated border border-border-muted hover:border-accent-deep rounded-xl p-4 transition-colors group"
        >
          <div class="mb-3 h-5">
            {#if p}
              <DeadlineChip phase={p.phase} duration={p.duration} />
            {/if}
          </div>
          <div class="font-bold text-fg group-hover:text-accent transition-colors truncate">
            {s.league.name}
          </div>
          <div class="font-mono text-[11px] text-fg-dim mt-0.5 truncate">{s.league.slug}</div>
          <div class="font-mono text-[11px] text-fg-faint mt-3 truncate">
            {s.currentRound ? `r-${s.currentRound.id} · ${s.currentRound.name}` : `s${s.seasonNumber}`}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</section>

<!-- All leagues -->
<section class="bg-surface border border-border-muted rounded-xl p-6">
  <header class="flex items-start gap-4 mb-5">
    <div class="flex-1 min-w-0">
      <h2 class="text-xl font-bold text-fg">All leagues</h2>
      <p class="text-fg-muted text-sm mt-0.5">
        All {totalLeagues} league{totalLeagues === 1 ? '' : 's'} you've adopted, sorted by next action.
      </p>
    </div>
  </header>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each allLeagues as row (row.slug)}
      <a
        href={row.href}
        class="block bg-bg-elevated border border-border-muted hover:border-accent-deep rounded-xl p-4 transition-colors group"
      >
        <div class="flex items-center gap-2 mb-3 h-5">
          <DotIndicator status={row.status} />
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">
            {row.status}
          </span>
        </div>
        <div class="font-bold text-fg group-hover:text-accent transition-colors truncate">
          {row.name}
        </div>
        <div class="font-mono text-[11px] text-fg-dim mt-0.5 truncate">{row.slug}</div>
        <div class="font-mono text-[11px] text-fg-faint mt-3 truncate">{row.sublineMono}</div>
      </a>
    {/each}
  </div>
</section>

<!--
  Sprint-1 carryover surfaces removed from the home view per prototype-A scope
  (Active Now / Past Seasons / All Songs Ever). pastLeagues + mlSongs +
  chatMentions are still in the loader payload; they can return on a dedicated
  /library or /songs route later. No data loss — the loader is untouched.
-->
