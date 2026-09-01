<!-- ui/src/lib/components/RefineBoard.svelte -->
<!--
  spec §7.4 — the refine board ("the sudoku board").

  Task 4 ships the RESTING surface only: song blocks, read-only candidate rows,
  the empty state and the roll-up line. Every control on a row (state-chip
  cycling, the expand-to-edit editor, the roster strip, remove) belongs to
  Task 5 and is deliberately absent here rather than stubbed — a dead button is
  worse than no button.

  Design source: docs/design_handoff_refine_grid/ (README §1–§3, TOKEN-MAP.md).
  Recreated with Tailwind utilities against app.css @theme tokens; none of the
  prototype's inline styles or its .dc.html runtime are ported. The only inline
  styles below are the two values that are genuinely dynamic or not expressible
  as a utility (the certainty fill percentage, the reserved-slot dash pattern).
-->
<script lang="ts">
  import type { WorkspaceData, WorkspaceSong } from '$lib/guessing/workspaceData.js';
  import type { Candidate, CandidateStatus } from '$lib/guessing/candidates.js';
  import { sortCandidates, findConflicts, rollup } from '$lib/guessing/board.js';

  // `roundId` and `onchanged` are the write plumbing Task 5 consumes; they are
  // part of the agreed interface, so they are declared now and unused until
  // rows become interactive.
  let {
    data,
    roundId,
    onchanged,
  }: {
    data: WorkspaceData;
    roundId: number;
    onchanged?: () => void;
  } = $props();

  function nameFor(playerId: number): string {
    return data.roster.find((p) => p.id === playerId)?.name ?? `#${playerId}`;
  }

  const STATUS_CHIP: Record<CandidateStatus, { glyph: string; rail: string; railWidth: string; chip: string; weight: string }> = {
    possible: {
      glyph: '○',
      rail: 'border-l-border-muted',
      railWidth: 'border-l-2',
      chip: 'border-border text-fg-dim',
      weight: 'font-normal',
    },
    prime: {
      glyph: '◐',
      rail: 'border-l-amber',
      railWidth: 'border-l-2',
      chip: 'border-amber text-amber bg-amber/10',
      weight: 'font-semibold',
    },
    locked: {
      glyph: '●',
      rail: 'border-l-accent',
      railWidth: 'border-l-[3px]',
      chip: 'border-accent text-accent bg-accent/15',
      weight: 'font-bold',
    },
  };

  const conflicts = $derived(findConflicts(data));
  const summary = $derived(rollup(data));

  const ROLLUP_TONE = {
    progress: 'text-fg-dim',
    conflict: 'text-ember',
    settled: 'text-moss',
  } as const;

  /**
   * `rollup()` is a pure function of the payload and has no roster, so its
   * conflict text names songs (`#3 & #6`) but never the player. The design
   * calls for the name, so it is substituted here, where the roster exists.
   * Deliberate: board.ts stays roster-free (see task brief). If the sentence
   * ever changes shape the replace simply no-ops and the un-named text shows.
   */
  const rollupText = $derived.by(() => {
    if (summary.tone !== 'conflict') return summary.text;
    const first = [...conflicts.keys()][0];
    if (first === undefined) return summary.text;
    return summary.text.replace('· locked on ', `· ${nameFor(first)} locked on `);
  });

  /** 1-based playlist position, the `#n` every reference on this board uses. */
  function songNumber(spotifyUri: string): number {
    return data.songs.findIndex((s) => s.spotifyUri === spotifyUri) + 1;
  }

  /** The song this player is committed to OTHER than the one being rendered. */
  type Elsewhere = { kind: 'dimmed' | 'taken'; at: number } | null;
  function elsewhereFor(playerId: number, spotifyUri: string): Elsewhere {
    // `data.availability` is the server's verdict (playerAvailability) and is
    // the authority on whether a player is committed at all; it is grid-wide,
    // so it cannot say WHERE. The location is read off the payload's songs.
    if ((data.availability[playerId] ?? 'free') === 'free') return null;
    let dimmed: number | null = null;
    for (const song of data.songs) {
      if (song.spotifyUri === spotifyUri) continue;
      for (const c of song.candidates) {
        if (c.playerId !== playerId) continue;
        if (c.status === 'locked') return { kind: 'taken', at: songNumber(song.spotifyUri) };
        if (c.status === 'prime' && dimmed === null) dimmed = songNumber(song.spotifyUri);
      }
    }
    return dimmed === null ? null : { kind: 'dimmed', at: dimmed };
  }

  /** The `⚠ <Name> locked twice` marker, when this song is half of a duplicate. */
  function conflictTag(song: WorkspaceSong): string | null {
    for (const c of song.candidates) {
      if (c.status === 'locked' && conflicts.has(c.playerId)) {
        return `⚠ ${nameFor(c.playerId)} locked twice`;
      }
    }
    return null;
  }

  function certaintyPct(c: Candidate): number {
    return c.certainty === null ? 0 : c.certainty;
  }
</script>

<div class="mb-2 flex items-baseline gap-3">
  <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">phase: refine</span>
  <span class="font-mono text-[11px] text-fg-dim">build the case — name suspects, eliminate across the board</span>
</div>

<!-- validation roll-up — one mono line, three registers (README §1 / D5) -->
<div class="mb-3.5 px-0.5 font-mono text-xs leading-relaxed {ROLLUP_TONE[summary.tone]}">{rollupText}</div>

<div class="grid grid-cols-[1fr_244px] items-start gap-[18px]">
  <!-- ===== BOARD ===== -->
  <div class="flex flex-col gap-4">
    {#each data.songs as song, i (song.spotifyUri)}
      {@const tag = conflictTag(song)}
      <div class="flex flex-col gap-[5px]">
        <!-- song header -->
        <div class="flex items-baseline gap-[9px] px-0.5 pb-0.5">
          <span class="font-mono text-xs text-accent">#{i + 1}</span>
          <span class="text-sm font-bold text-fg">{song.title}</span>
          <span class="text-xs text-fg-muted">{song.artists}</span>
          <span class="flex-1"></span>
          <span class="inline-flex items-center gap-[5px]">
            {#if tag}
              <span class="font-mono text-[10px] tracking-[0.06em] text-ember">{tag}</span>
            {/if}
            <!-- The gut pick is hard-locked once the slate is locked: this is a
                 read-only marker on a separate layer, so it carries no button,
                 no cursor and no hover — it must not look clickable. -->
            <span class="font-mono text-[10px] tracking-[0.04em] text-fg-faint select-none">
              gut · {song.gutPickPlayerId === null ? '—' : nameFor(song.gutPickPlayerId)}
            </span>
          </span>
        </div>

        {#if song.candidates.length === 0}
          <div
            class="border border-dashed border-border-muted border-l-2 border-l-border-muted bg-bg px-3 py-2 font-mono text-[11px] tracking-[0.04em] text-fg-faint"
          >no candidates yet — add a suspect below</div>
        {:else}
          {#each sortCandidates(song.candidates) as c (c.playerId)}
            {@const chip = STATUS_CHIP[c.status]}
            {@const away = elsewhereFor(c.playerId, song.spotifyUri)}
            <div
              class="flex items-center gap-2.5 bg-surface px-3 py-[7px] {chip.railWidth}
                     {away?.kind === 'dimmed' ? 'border-l-amber' : chip.rail}
                     {away?.kind === 'taken' ? 'opacity-45' : away?.kind === 'dimmed' ? 'opacity-75' : ''}"
            >
              <!-- The design's name column is 66px; that is a MINIMUM here, not
                   a fixed width. The prototype's fixture names are short, the
                   real Boarz roster is not ("Jonathan Black"), and a hard 66px
                   clips the one thing the row exists to say. Column alignment
                   is preserved by the right-hand cluster's fixed widths. -->
              <span
                class="min-w-[66px] shrink-0 whitespace-nowrap text-[13px] {chip.weight}
                       {away?.kind === 'taken' ? 'text-fg-faint line-through' : away?.kind === 'dimmed' ? 'text-fg-muted' : 'text-fg'}"
              >{nameFor(c.playerId)}</span>

              <!-- state chip — read-only in Task 4; Task 5 makes it the cycle
                   control. Glyph + label + rail carry the state without color. -->
              <span
                class="inline-flex items-center gap-[5px] rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap {chip.chip}"
              ><span class="text-[11px]">{chip.glyph}</span>{c.status}</span>

              <!-- availability tag: names WHERE they are committed (D3) -->
              {#if away}
                <span
                  class="font-mono text-[10px] tracking-[0.04em] whitespace-nowrap {away.kind === 'taken' ? 'text-fg-dim' : 'text-amber'}"
                >{away.kind === 'taken' ? '●' : '◐'} {away.kind === 'taken' ? 'locked' : 'prime'} · #{away.at}</span>
              {/if}

              <span class="flex-1"></span>

              <!-- factors / notes presence dots -->
              <span class="inline-flex items-center gap-[3px]" title="factors · notes">
                <span class="h-1.5 w-1.5 rounded-[1px] {c.factors ? 'bg-accent' : 'bg-border-muted'}"></span>
                <span class="h-1.5 w-1.5 rounded-[1px] {c.notes ? 'bg-accent' : 'bg-border-muted'}"></span>
              </span>

              <!-- your certainty -->
              <span class="flex w-[58px] items-center justify-end gap-1.5">
                <span
                  class="h-1 w-[26px] rounded-full"
                  style="background: linear-gradient(to right, var(--color-accent) {certaintyPct(c)}%, var(--color-border-muted) {certaintyPct(c)}%)"
                ></span>
                <span class="font-mono text-[11px] text-fg-muted">{c.certainty === null ? '—' : c.certainty}</span>
              </span>

              <!-- RESERVED model slot (Project D). Inert by design and NOT dead
                   weight: it holds the column so the AI likelihood drops in
                   later without reflowing the row. Do not remove. -->
              <span
                class="flex w-[52px] items-center justify-end gap-[5px] border-l border-surface-hover pl-2.5"
                title="AI likelihood — reserved for Project D"
              >
                <span class="model-dash h-1 w-5 rounded-full"></span>
                <span class="font-mono text-[11px] text-border">—</span>
              </span>
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <!-- ===== LEDGER (Task 7 fills this) ===== -->
  <div></div>
</div>

<style>
  /* A repeating dash pattern is not expressible as a Tailwind utility; it is
     the reserved model slot's placeholder bar. */
  .model-dash {
    background: repeating-linear-gradient(
      90deg,
      var(--color-border-muted) 0 3px,
      transparent 3px 6px
    );
  }
</style>
