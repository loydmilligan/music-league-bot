<!-- ui/src/lib/components/AvailabilityLedger.svelte -->
<!--
  spec §7.4 — the refine board's availability ledger (Task 7).

  Fills the 244px column RefineBoard.svelte reserved in Task 4. Answers
  "who's still free?" for the whole roster at once, and — per handoff README
  §6 — doubles as the songs-vs-players supply count that makes an
  unsatisfiable end-state (more songs than available players) legible rather
  than something the owner discovers by failing to finish.

  Design source: docs/design_handoff_refine_grid/README.md §6, TOKEN-MAP.md.
  Recreated with Tailwind utilities against app.css @theme tokens; nothing
  ported from the prototype's inline styles or its .dc.html runtime.

  THE LEDGER OWNS NO DATA. `data.availability` is the server's grid-wide
  verdict (playerAvailability) and `ledgerEntry` (board.ts) only LOCATES the
  commitment it has already asserted — same split CandidateRow.svelte uses via
  `commitmentElsewhere`. No availability is computed in here.
-->
<script lang="ts">
  import type { WorkspaceData } from '$lib/guessing/workspaceData.js';
  import { ledgerEntry } from '$lib/guessing/board.js';

  let { data }: { data: WorkspaceData } = $props();

  const rows = $derived(
    data.roster
      .map((p) => ({ ...p, entry: ledgerEntry(data, p.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const counts = $derived.by(() => {
    let free = 0, dimmed = 0, taken = 0;
    for (const r of rows) {
      if (r.entry.kind === 'free') free++;
      else if (r.entry.kind === 'dimmed') dimmed++;
      else taken++;
    }
    return { free, dimmed, taken };
  });

  const RAIL: Record<'free' | 'dimmed' | 'taken', string> = {
    free: 'border-l-border-muted',
    dimmed: 'border-l-amber',
    taken: 'border-l-accent',
  };

  function labelFor(entry: { kind: 'free' | 'dimmed' | 'taken'; at: number | null }): string {
    if (entry.kind === 'free') return 'free';
    if (entry.kind === 'dimmed') return `prime #${entry.at}`;
    return `lock #${entry.at}`;
  }
</script>

<div class="sticky top-4 flex flex-col bg-bg-elevated border border-border-muted">
  <!-- header + live summary -->
  <div class="flex flex-col gap-1 border-b border-border-muted px-3 py-2.5">
    <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg">availability ledger</span>
    <span class="font-mono text-[10px] tracking-[0.04em] text-fg-dim"
      >{counts.free} free · {counts.dimmed} dimmed · {counts.taken} taken</span
    >
    <!-- songs-vs-players supply count — what makes an unsatisfiable end-state
         legible: a round CAN genuinely have more songs than available
         players. -->
    <span class="font-mono text-[10px] tracking-[0.04em] text-fg-faint"
      >{data.songs.length} song{data.songs.length === 1 ? '' : 's'} · {data.roster.length} player{data.roster.length === 1
        ? ''
        : 's'}</span
    >
  </div>

  <!-- one row per eligible player -->
  <div class="flex flex-col">
    {#each rows as r (r.id)}
      <div
        class="flex items-center gap-2 border-l-2 {RAIL[r.entry.kind]} px-3 py-[7px]"
      >
        <span
          class="min-w-0 flex-1 truncate text-[13px]
                 {r.entry.kind === 'taken'
            ? 'text-fg-faint line-through'
            : r.entry.kind === 'dimmed'
              ? 'text-fg-muted'
              : 'text-fg'}"
        >{r.name}</span>
        <span
          class="shrink-0 font-mono text-[10px] tracking-[0.04em] whitespace-nowrap
                 {r.entry.kind === 'taken' ? 'text-accent' : r.entry.kind === 'dimmed' ? 'text-amber' : 'text-fg-dim'}"
        >{labelFor(r.entry)}</span>
      </div>
    {/each}
  </div>

  <!-- footer legend — the three rails and the reserved model key -->
  <div class="flex flex-col gap-1 border-t border-border-muted px-3 py-2.5 font-mono text-[9px] tracking-[0.04em] text-fg-faint">
    <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 border-l-2 border-l-border-muted"></span>free — no commitment</span>
    <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 border-l-2 border-l-amber"></span>dimmed — prime elsewhere (advisory)</span>
    <span class="flex items-center gap-1.5"><span class="inline-block h-2 w-2 border-l-2 border-l-accent"></span>taken — locked elsewhere (hard)</span>
    <span class="pt-1 opacity-70">model % · reserved · Project D</span>
  </div>
</div>
