<!--
  Component showcase for the sprint-2 chip/badge atoms. Not linked from
  navigation — visit /_examples to eyeball them against the prototypes.
-->
<script lang="ts">
  import DeadlineChip from '$lib/components/DeadlineChip.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import DotIndicator from '$lib/components/DotIndicator.svelte';
</script>

<svelte:head><title>Component examples</title></svelte:head>

<div class="space-y-10 max-w-2xl">
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
