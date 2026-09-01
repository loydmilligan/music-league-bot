<!-- ui/src/lib/components/CandidateRow.svelte -->
<!--
  spec §7.4 — one candidate row of the refine board: the resting summary line
  (Task 4's markup, moved here) plus Task 5's interactions — the state chip,
  the expand-in-place editor, and the inline remove confirm.

  Design source: docs/design_handoff_refine_grid/ README §3, §4 and
  "Interactions & behavior"; TOKEN-MAP.md for every colour. Recreated with
  Tailwind utilities against app.css @theme tokens — none of the prototype's
  inline styles or its .dc.html runtime are ported. The only <style> below is
  the reserved slot's dash pattern, which has no utility equivalent.

  THE ROW OWNS NO DATA. Every edit goes up through `onedit` / `oncycle` /
  `onremove`; the parent owns the debounce timers, the fetches and the error
  state, exactly as VotingLab.svelte owns them for VotingLabSongRow.svelte.
  Local state here is UI-only: expanded, in-flight flags, confirm-to-remove.

  It deliberately does NOT take `roundId`: it issues no request of its own, and
  a prop it never reads is the same lie as a button that does nothing.
-->
<script lang="ts">
  import type { Candidate, CandidateStatus } from '$lib/guessing/candidates.js';

  /** The subset of a candidate this row can edit — mirrors the route's schema. */
  type CandidatePatch = {
    status?: CandidateStatus;
    certainty?: number | null;
    factors?: string;
    notes?: string;
  };

  let {
    candidate,
    name,
    availability,
    error = null,
    onedit,
    oncycle,
    onremove,
    onretry,
  }: {
    candidate: Candidate;
    /** Display name — the roster lookup lives in the parent. */
    name: string;
    /** Where this player is committed on ANOTHER song, from `commitmentElsewhere`. */
    availability: { kind: 'dimmed' | 'taken'; at: number } | null;
    /** The rejected-write message for this row, or null. Owned by the parent. */
    error?: string | null;
    /** Debounced field edit (certainty / factors / notes). */
    onedit: (patch: CandidatePatch) => void;
    /** Immediate status write; resolves once the write AND the reload are done. */
    oncycle: (next: CandidateStatus) => Promise<void>;
    onremove: () => Promise<void>;
    onretry: () => void;
  } = $props();

  const STATUS_CHIP: Record<
    CandidateStatus,
    { glyph: string; rail: string; railWidth: string; chip: string; weight: string }
  > = {
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

  const NEXT_STATUS: Record<CandidateStatus, CandidateStatus> = {
    possible: 'prime',
    prime: 'locked',
    locked: 'possible', // wraps — README §"Interactions & behavior"
  };

  let expanded = $state(false);
  let cycling = $state(false);
  let removing = $state(false);
  let confirmingRemove = $state(false);

  const chip = $derived(STATUS_CHIP[candidate.status]);
  const pct = $derived(candidate.certainty === null ? 0 : candidate.certainty);

  /**
   * The rail is the row's whole error surface: on a rejected write it goes
   * ember and OVERRIDES both the state rail and the dimmed-availability rail,
   * because "this did not save" outranks anything else the rail could say.
   */
  const rail = $derived(
    error
      ? 'border-l-ember'
      : availability?.kind === 'dimmed'
        ? 'border-l-amber'
        : chip.rail,
  );

  async function cycle(evt: MouseEvent) {
    // Cycling must never expand the row — the chip is inside the row's own
    // click target (README §3).
    evt.stopPropagation();
    if (cycling) return;
    cycling = true;
    try {
      await oncycle(NEXT_STATUS[candidate.status]);
    } finally {
      cycling = false;
    }
  }

  function toggle() {
    expanded = !expanded;
  }

  function onRowKey(evt: KeyboardEvent) {
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      toggle();
    }
  }

  async function doRemove() {
    removing = true;
    try {
      await onremove();
    } finally {
      removing = false;
      confirmingRemove = false;
    }
  }
</script>

<div class="flex flex-col">
  <!-- ===== resting row ===== -->
  <div
    role="button"
    tabindex="0"
    aria-expanded={expanded}
    onclick={toggle}
    onkeydown={onRowKey}
    class="flex cursor-pointer items-center gap-2.5 bg-surface px-3 py-[7px] transition-colors hover:bg-surface-hover
           {chip.railWidth} {rail}
           {availability?.kind === 'taken' ? 'opacity-45' : availability?.kind === 'dimmed' ? 'opacity-75' : ''}"
  >
    <!-- The design's name column is 66px; that is a MINIMUM here, not a fixed
         width. The prototype's fixture names are short, the real Boarz roster
         is not ("Jonathan Black"), and a hard 66px clips the one thing the row
         exists to say. Column alignment is preserved by the right-hand
         cluster's fixed widths. -->
    <span
      class="min-w-[66px] shrink-0 whitespace-nowrap text-[13px] {chip.weight}
             {availability?.kind === 'taken'
        ? 'text-fg-faint line-through'
        : availability?.kind === 'dimmed'
          ? 'text-fg-muted'
          : 'text-fg'}"
    >{name}</span>

    <!-- state chip — shows the CURRENT state and is itself the cycle control.
         Glyph + label + rail carry the state without relying on colour.
         Fires immediately (the one write on this surface that is not
         debounced): it has grid-wide consequences that must not lag. -->
    <button
      type="button"
      disabled={cycling}
      onclick={cycle}
      title="cycle: possible → prime → locked"
      class="inline-flex cursor-pointer items-center gap-[5px] rounded-sm border px-2 py-[3px] font-mono text-[10px]
             font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors
             disabled:cursor-not-allowed disabled:opacity-60 {chip.chip}"
    ><span class="text-[11px]">{chip.glyph}</span>{candidate.status}</button>

    <!-- availability tag: names WHERE they are committed (D3) -->
    {#if availability}
      <span
        class="font-mono text-[10px] tracking-[0.04em] whitespace-nowrap {availability.kind === 'taken'
          ? 'text-fg-dim'
          : 'text-amber'}"
      >{availability.kind === 'taken' ? '●' : '◐'} {availability.kind === 'taken' ? 'locked' : 'prime'} · #{availability.at}</span>
    {/if}

    <span class="flex-1"></span>

    <!-- factors / notes presence dots -->
    <span class="inline-flex items-center gap-[3px]" title="factors · notes">
      <span class="h-1.5 w-1.5 rounded-[1px] {candidate.factors ? 'bg-accent' : 'bg-border-muted'}"></span>
      <span class="h-1.5 w-1.5 rounded-[1px] {candidate.notes ? 'bg-accent' : 'bg-border-muted'}"></span>
    </span>

    <!-- your certainty -->
    <span class="flex w-[58px] items-center justify-end gap-1.5">
      <span
        class="h-1 w-[26px] rounded-full"
        style="background: linear-gradient(to right, var(--color-accent) {pct}%, var(--color-border-muted) {pct}%)"
      ></span>
      <span class="font-mono text-[11px] text-fg-muted">{candidate.certainty === null ? '—' : candidate.certainty}</span>
    </span>

    <!-- RESERVED model slot (Project D). Inert by design and NOT dead weight:
         it holds the column so the AI likelihood drops in later without
         reflowing the row. Do not remove. -->
    <span
      class="flex w-[52px] items-center justify-end gap-[5px] border-l border-surface-hover pl-2.5"
      title="AI likelihood — reserved for Project D"
    >
      <span class="model-dash h-1 w-5 rounded-full"></span>
      <span class="font-mono text-[11px] text-border">—</span>
    </span>
  </div>

  <!-- ===== expanded editor — in place, no modal, scroll kept (README §4) ===== -->
  {#if expanded}
    <div class="flex flex-col gap-[11px] bg-bg-elevated px-3.5 py-3 {chip.railWidth} {rail}">
      <div class="flex items-center gap-2.5">
        <span class="w-[58px] shrink-0 font-mono text-[9px] tracking-[0.14em] text-fg-faint uppercase">certainty</span>
        <!-- Native range on purpose: there is no custom slider anywhere in this
             repo and adding the first one is not this task's job. -->
        <input
          type="range"
          min="0"
          max="100"
          value={candidate.certainty ?? 0}
          oninput={(e) => onedit({ certainty: Number(e.currentTarget.value) })}
          class="accent-accent flex-1 cursor-pointer"
          aria-label="certainty"
        />
        <span class="w-7 text-right font-mono text-xs text-accent">{candidate.certainty === null ? '—' : candidate.certainty}</span>
      </div>

      <div class="flex gap-2.5">
        <span class="w-[58px] shrink-0 pt-2 font-mono text-[9px] tracking-[0.14em] text-fg-faint uppercase">factors</span>
        <textarea
          rows="2"
          placeholder="why them — the evidence"
          value={candidate.factors}
          oninput={(e) => onedit({ factors: e.currentTarget.value })}
          aria-label="factors"
          class="flex-1 resize-y rounded-lg border border-border bg-surface px-2.5 py-[7px] text-[13px] leading-[1.45] text-fg
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        ></textarea>
      </div>

      <div class="flex gap-2.5">
        <span class="w-[58px] shrink-0 pt-2 font-mono text-[9px] tracking-[0.14em] text-fg-faint uppercase">notes</span>
        <textarea
          rows="2"
          placeholder="loose thinking"
          value={candidate.notes}
          oninput={(e) => onedit({ notes: e.currentTarget.value })}
          aria-label="notes"
          class="flex-1 resize-y rounded-lg border border-border bg-surface px-2.5 py-[7px] text-[13px] leading-[1.45] text-fg
                 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        ></textarea>
      </div>

      <!-- RESERVED (Project D). Inert. -->
      <div class="flex items-center gap-2.5 opacity-55">
        <span class="w-[58px] shrink-0 font-mono text-[9px] tracking-[0.14em] text-fg-faint uppercase">model</span>
        <div
          class="flex flex-1 items-center gap-2 rounded-lg border border-dashed border-border-muted px-2.5 py-[7px] font-mono text-[11px] text-border"
        >likelihood % + reasoning<span class="text-fg-faint">· reserved · Project D</span></div>
      </div>

      <div class="flex items-center gap-2.5 pt-0.5">
        <span class="flex-1"></span>
        {#if confirmingRemove}
          <!-- Inline confirm in place — never a modal (GuessWorkspace.svelte's
               archive-rehearsal idiom). -->
          <span class="font-mono text-[10px] tracking-[0.06em] text-fg-muted">drop {name} from this song?</span>
          <button
            type="button"
            disabled={removing}
            onclick={doRemove}
            class="cursor-pointer rounded-sm border border-warn bg-warn/20 px-2 py-1 font-mono text-[10px] tracking-[0.08em]
                   text-warn uppercase transition-colors hover:bg-warn/30 disabled:cursor-not-allowed disabled:opacity-60"
          >Confirm</button>
          <button
            type="button"
            disabled={removing}
            onclick={() => (confirmingRemove = false)}
            class="cursor-pointer px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-fg-muted uppercase
                   transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
          >Cancel</button>
        {:else}
          <button
            type="button"
            onclick={() => (confirmingRemove = true)}
            class="cursor-pointer font-mono text-[10px] tracking-[0.08em] text-fg-faint uppercase transition-colors hover:text-fg"
          >remove</button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ===== rejected write — required, not decorative =====
       The attempted value stays on screen (it is what the user meant); the
       rail is ember and this one line says so. No toast — this app has none.
       A successful retry reloads, and the DOM reconciles to the server. -->
  {#if error}
    <div class="px-3 py-1 font-mono text-sm text-red-400">
      {error} ·
      <button type="button" onclick={onretry} class="cursor-pointer text-accent underline">retry now</button>
    </div>
  {/if}
</div>

<style>
  /* A repeating dash pattern is not expressible as a Tailwind utility; it is
     the reserved model slot's placeholder bar. */
  .model-dash {
    background: repeating-linear-gradient(90deg, var(--color-border-muted) 0 3px, transparent 3px 6px);
  }
</style>
