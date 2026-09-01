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
  import { tick } from 'svelte';
  import type { Candidate, CandidateStatus, CandidatePatch } from '$lib/guessing/candidates.js';

  let {
    candidate,
    name,
    availability,
    flash = 0,
    error = null,
    onedit,
    oncycle,
    onremove,
    onretry,
    onsettle,
  }: {
    candidate: Candidate;
    /** Display name — the roster lookup lives in the parent. */
    name: string;
    /** Where this player is committed on ANOTHER song, from `commitmentElsewhere`. */
    availability: { kind: 'dimmed' | 'taken'; at: number } | null;
    /**
     * The propagation flash. 0 = none; any other value is the board's flash
     * epoch, and CHANGING it re-fires the tint. The parent owns the diff
     * (changedAvailability) — this row only plays what it is told to play.
     */
    flash?: number;
    /** The rejected-write message for this row, or null. Owned by the parent. */
    error?: string | null;
    /** Debounced field edit (certainty / factors / notes). */
    onedit: (patch: CandidatePatch) => void;
    /** Immediate status write; resolves once the write AND the reload are done. */
    oncycle: (next: CandidateStatus) => Promise<void>;
    onremove: () => Promise<void>;
    onretry: () => void;
    /** Fired when the editor closes — the parent's cue to re-settle row order. */
    onsettle: () => void;
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

  let chipEl = $state<HTMLButtonElement | null>(null);

  async function cycle(evt: MouseEvent) {
    // Cycling must never expand the row — the chip is inside the row's own
    // click target (README §3).
    evt.stopPropagation();
    if (cycling) return;
    // `disabled` blurs a focused element, so a keyboard user cycling the chip
    // is dumped on <body> after one press and has to tab all the way back for
    // the next. Restore focus afterwards — but only if the chip actually held
    // it, so a mouse cycle never steals focus from somewhere else.
    const hadFocus = document.activeElement === chipEl;
    cycling = true;
    try {
      await oncycle(NEXT_STATUS[candidate.status]);
    } finally {
      cycling = false;
      // tick() is load-bearing: `cycling = false` does not clear the DOM's
      // `disabled` until Svelte flushes, and focus() on a still-disabled
      // button is silently a no-op.
      if (hadFocus) {
        await tick();
        chipEl?.focus();
      }
    }
  }

  function toggle() {
    expanded = !expanded;
    // Collapsing is the "done editing this row" signal: safe to let the board
    // re-sort now, which it deliberately does not do while you drag certainty.
    if (!expanded) onsettle();
  }

  /**
   * Enter/Space toggles the editor — but ONLY when the row itself has focus.
   *
   * The chip is a descendant of this handler's element, so a keyboard
   * activation of the chip bubbles its keydown up here too. Without this
   * guard, Space on the chip would be preventDefault()ed and swallowed into
   * "expand the row" — the chip would be mouse-cyclable but not
   * keyboard-cyclable, which no mouse-driven browser pass can see. The chip's
   * own click handler still stops the CLICK; this stops the KEYDOWN.
   */
  function onRowKey(evt: KeyboardEvent) {
    if (evt.target !== evt.currentTarget) return;
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
  <!-- The resting row gets its own positioning context so the propagation
       flash can sit OUTSIDE the row's `opacity-45`/`opacity-75` — a taken row
       is exactly the row a lock just changed, and inheriting 45% would fade
       the flash out on the one row that most needs to show it. -->
  <div class="relative">
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
      bind:this={chipEl}
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

    <!-- Propagation flash. Keyed on the epoch so a repeated lock builds a NEW
         element — a CSS animation does not restart on a class that is already
         present, so re-applying it would silently do nothing the second time.
         Purely decorative and inert: no pointer events, aria-hidden. -->
    {#key flash}
      {#if flash > 0}
        <span class="prop-flash pointer-events-none absolute inset-0" aria-hidden="true"></span>
      {/if}
    {/key}
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

  /* One-shot ~700ms accent tint — README §"Availability propagation". A single
     keyframe, no animation library (none exists in this repo). */
  .prop-flash {
    background: var(--color-accent);
    opacity: 0;
    animation: prop-flash 700ms ease-out;
  }

  @keyframes prop-flash {
    0% { opacity: 0; }
    16% { opacity: 0.32; }
    100% { opacity: 0; }
  }

  /* Reduced motion still has to SHOW the consequence — degrading to nothing
     defeats the point. No animation; a flat tint that the parent's clear timer
     removes ~900ms later. */
  @media (prefers-reduced-motion: reduce) {
    .prop-flash {
      animation: none;
      opacity: 0.2;
    }
  }
</style>
