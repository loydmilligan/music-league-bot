<!--
  DeadlineChip — orange-bordered mono pill from prototype A's "Needs you this week" cards.
  Example:
    <DeadlineChip phase="submissions" duration="3D 14H" />
    <DeadlineChip phase="voting"      duration="1D 22H" />
-->
<script lang="ts">
  type Phase = 'submissions' | 'voting' | 'review' | 'archived';

  let { phase, duration }: { phase: Phase; duration: string } = $props();

  const labels: Record<Phase, string> = {
    submissions: 'SUBMISSIONS',
    voting: 'VOTING',
    review: 'REVIEW',
    archived: 'ARCHIVED',
  };
</script>

<span
  class="inline-flex items-center gap-1.5 border border-accent-deep text-accent font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-sm whitespace-nowrap"
>
  <span>{labels[phase]}</span>
  <span aria-hidden="true" class="opacity-70">·</span>
  <span>{duration.toUpperCase()}</span>
</span>
