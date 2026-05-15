<!--
  StatusChip — the "2 OPEN" / "VOTING" / etc. pill seen across all prototypes.
  Example:
    <StatusChip label="2 OPEN" tone="accent" />
    <StatusChip label="WATCHER LIVE" tone="health" />
    <StatusChip label="IDLE" tone="muted" />
    <StatusChip label="STALE" tone="warn" />
-->
<script lang="ts">
  type Tone = 'accent' | 'health' | 'muted' | 'warn';

  let { label, tone = 'muted' }: { label: string; tone?: Tone } = $props();

  const tones: Record<Tone, string> = {
    accent: 'bg-accent-bg text-accent border-accent-deep',
    health: 'bg-health-bg text-health border-health/40',
    muted:  'bg-surface text-fg-dim border-border-muted',
    warn:   'bg-warn/15 text-warn border-warn/40',
  };
</script>

<span
  class="inline-flex items-center border font-mono text-[10px] tracking-widest uppercase px-2 py-0.5 rounded-sm whitespace-nowrap {tones[tone]}"
>
  {label}
</span>
