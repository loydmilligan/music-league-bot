<script lang="ts">
  import { groupFailures } from './triage.js';
  import type { QueueFailure } from '$lib/db/metadataQueue.js';
  import type { GroupBy, FailureGroup } from './triage.js';

  let {
    failures,
    jobMeta = {},
    onBulkAction,
  }: {
    failures: QueueFailure[];
    jobMeta?: Record<string, { name: string; provider: string }>;
    onBulkAction: (ids: number[], action: 'retry' | 'dismiss') => Promise<void>;
  } = $props();

  let by = $state<GroupBy>('reason');
  let busyKey = $state<string | null>(null);

  const groups = $derived(groupFailures(failures, by));

  const TONE_BORDER: Record<string, string> = {
    amber: 'border-amber',
    ember: 'border-ember',
    sky: 'border-sky',
    muted: 'border-border-muted',
  };

  const BY_LABELS: { value: GroupBy; label: string }[] = [
    { value: 'reason', label: 'Reason' },
    { value: 'job', label: 'Job' },
    { value: 'round', label: 'Round' },
  ];

  async function handleAction(group: FailureGroup, action: 'retry' | 'dismiss') {
    if (busyKey) return;
    busyKey = `${group.key}:${action}`;
    try {
      await onBulkAction(group.ids, action);
    } finally {
      busyKey = null;
    }
  }
</script>

<!-- Grouped failures triage panel -->
<div>
  <!-- Header row: label + group-by toggle -->
  <div class="flex items-center justify-between gap-4 mb-3">
    <span class="font-mono text-[10px] tracking-widest uppercase text-warn">
      Failures ({failures.length})
    </span>
    <div class="flex items-center gap-1">
      <span class="font-mono text-[9px] tracking-widest uppercase text-fg-faint mr-1">Group by</span>
      {#each BY_LABELS as opt (opt.value)}
        <button
          type="button"
          onclick={() => { by = opt.value; }}
          class="font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded-sm border transition-colors {by === opt.value
            ? 'border-accent text-accent bg-accent/10'
            : 'border-border text-fg-faint hover:text-fg hover:border-border-muted'}"
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Groups list -->
  <div class="space-y-2">
    {#each groups as group (group.key)}
      {@const borderClass = TONE_BORDER[group.tone] ?? 'border-border-muted'}
      <div class="border-l-2 {borderClass} pl-3 py-1.5 flex items-center justify-between gap-3">
        <!-- Left: glyph + label + count + why -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] {borderClass.replace('border-', 'text-')}">{group.glyph}</span>
            <span class="text-xs text-fg font-medium">{group.label}</span>
            <span class="font-mono text-[10px] text-fg-faint">({group.count})</span>
          </div>
          <div class="text-[10px] text-fg-faint mt-0.5 truncate">{group.why}</div>
        </div>
        <!-- Right: action buttons (accent color only) -->
        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onclick={() => handleAction(group, 'retry')}
            disabled={busyKey !== null}
            class="font-mono text-[9px] tracking-widest uppercase transition-colors {busyKey === `${group.key}:retry`
              ? 'text-fg-faint cursor-not-allowed'
              : 'text-accent hover:text-accent-strong'}"
          >
            {busyKey === `${group.key}:retry` ? '…' : 'Retry all ↻'}
          </button>
          <button
            type="button"
            onclick={() => handleAction(group, 'dismiss')}
            disabled={busyKey !== null}
            class="font-mono text-[9px] tracking-widest uppercase transition-colors {busyKey === `${group.key}:dismiss`
              ? 'text-fg-faint cursor-not-allowed'
              : 'text-accent hover:text-accent-strong'}"
          >
            {busyKey === `${group.key}:dismiss` ? '…' : 'Dismiss ×'}
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
