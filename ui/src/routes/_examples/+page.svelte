<!--
  Component showcase for the sprint-2 chip/badge atoms. Not linked from
  navigation — visit /_examples to eyeball them against the prototypes.
-->
<script lang="ts">
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import DotIndicator from '$lib/components/DotIndicator.svelte';
  import HeadToHeadCard, { type H2HCardSong } from '$lib/components/HeadToHeadCard.svelte';

  const holdingLane: H2HCardSong = {
    id: 1,
    artist: 'Tom Waits',
    title: 'Hold On',
    themeFit: 5,
    discoveryPotential: 3,
    nostalgiaPotential: 4,
    personalRating: 5,
    notes: 'Cuts straight to the bone — sparse arrangement, lyric does the work. Built for a round about resilience or perseverance; lands hard without ever overplaying its hand.',
    weightedScore: 4.35,
  };

  const challenger: H2HCardSong = {
    id: 2,
    artist: 'Big Thief',
    title: 'Sparrow',
    themeFit: 4,
    discoveryPotential: 5,
    nostalgiaPotential: 2,
    personalRating: 4,
    notes: 'Newer entry, leans on discovery. Adrianne Lenker doing what Adrianne Lenker does — feels like a contender on theme but I keep coming back to whether the production reads on a small speaker.',
    weightedScore: 3.95,
  };

  function pick(which: string) {
    return () => console.log('picked', which);
  }
</script>

<svelte:head><title>Component examples</title></svelte:head>

<div class="space-y-10 max-w-4xl">
  <section class="space-y-3">
    <SectionLabel>Head-to-head card</SectionLabel>
    <div class="grid gap-4 md:grid-cols-2">
      <HeadToHeadCard song={holdingLane} role="holding-lane" onPick={pick('holding-lane')} />
      <HeadToHeadCard song={challenger}  role="challenger"   onPick={pick('challenger')} />
    </div>
  </section>
  <section class="space-y-3">
    <SectionLabel>Deadline chip</SectionLabel>
    <div class="flex flex-wrap gap-2 bg-surface p-4 rounded-md border border-border-muted">
      <DeadlineChip phase="submissions" duration="3D 14H" />
      <DeadlineChip phase="voting" duration="1D 22H" />
      <DeadlineChip phase="review" duration="6H" />
      <DeadlineChip phase="archived" duration="—" />
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Status chip</SectionLabel>
    <div class="flex flex-wrap gap-2 bg-surface p-4 rounded-md border border-border-muted">
      <StatusChip label="2 OPEN" tone="accent" />
      <StatusChip label="WATCHER LIVE" tone="health" />
      <StatusChip label="IDLE" tone="muted" />
      <StatusChip label="STALE" tone="warn" />
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Section label</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-2">
      <SectionLabel>Leagues</SectionLabel>
      <SectionLabel>Cross-league next</SectionLabel>
      <SectionLabel>Active now</SectionLabel>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Dot indicator</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted flex flex-col gap-2 text-fg-muted text-sm">
      <div class="flex items-center gap-2"><DotIndicator status="active" /> hip-jammers — active round</div>
      <div class="flex items-center gap-2"><DotIndicator status="voting" /> second-best — voting</div>
      <div class="flex items-center gap-2"><DotIndicator status="open" /> open-submissions</div>
      <div class="flex items-center gap-2"><DotIndicator status="idle" /> idle league</div>
      <div class="flex items-center gap-2"><DotIndicator status="active" size="md" /> active (md)</div>
    </div>
  </section>

  <section class="space-y-3">
    <SectionLabel>Composed: leagues list row</SectionLabel>
    <div class="bg-surface p-4 rounded-md border border-border-muted space-y-2 text-sm">
      <div class="flex items-center gap-3">
        <DotIndicator status="active" />
        <span class="text-fg flex-1">hip-jammers</span>
        <DeadlineChip phase="submissions" duration="3D 14H" />
        <StatusChip label="2 OPEN" tone="accent" />
      </div>
      <div class="flex items-center gap-3">
        <DotIndicator status="voting" />
        <span class="text-fg flex-1">second-best</span>
        <DeadlineChip phase="voting" duration="1D 22H" />
      </div>
      <div class="flex items-center gap-3">
        <DotIndicator status="idle" />
        <span class="text-fg-dim flex-1">archived-league</span>
        <StatusChip label="IDLE" tone="muted" />
      </div>
    </div>
  </section>
</div>
