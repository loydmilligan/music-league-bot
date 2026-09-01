<!-- ui/src/lib/components/RefineBoard.svelte -->
<!--
  spec §7.4 — the refine board ("the sudoku board").

  Task 4 shipped the resting surface (song blocks, the empty state, the roll-up
  line). Task 5 makes the rows live and puts the write plumbing HERE: this
  component owns the debounce timers, the fetches and the per-row error state,
  and CandidateRow.svelte stays a controlled view — the same split as
  VotingLab.svelte / VotingLabSongRow.svelte. The roster strip (add a suspect)
  and the ledger still belong to later tasks and remain deliberately absent
  rather than stubbed.

  Design source: docs/design_handoff_refine_grid/ (README §1–§3, TOKEN-MAP.md).
  Recreated with Tailwind utilities against app.css @theme tokens; none of the
  prototype's inline styles or its .dc.html runtime are ported.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { WorkspaceData, WorkspaceSong } from '$lib/guessing/workspaceData.js';
  import type { Candidate, CandidateStatus, CandidatePatch } from '$lib/guessing/candidates.js';
  import { sortCandidates, findConflicts, rollup, commitmentElsewhere } from '$lib/guessing/board.js';
  import CandidateRow from './CandidateRow.svelte';

  let {
    data,
    roundId,
    onchanged,
  }: {
    data: WorkspaceData;
    roundId: number;
    /** The host's reload. Awaited, so availability is re-read server-side. */
    onchanged?: () => void | Promise<void>;
  } = $props();

  function nameFor(playerId: number): string {
    return data.roster.find((p) => p.id === playerId)?.name ?? `#${playerId}`;
  }

  // ===== writes =========================================================
  //
  // Shape copied from VotingLab.svelte:75-113 — the proven pattern in this
  // codebase — with one addition: patches MERGE per key instead of replacing,
  // because a row sends partial patches (`{notes}` then `{certainty}`) rather
  // than a whole ballot, and a naive replace would drop the earlier field.

  type PendingSave = { timer: ReturnType<typeof setTimeout>; fire: () => Promise<void> };

  /** One timer per (song, player) — editing one row never resets another's. */
  const saveTimers = new Map<string, PendingSave>();
  const pendingPatch = new Map<string, CandidatePatch>();
  /** Re-fire for the `retry now` affordance, per key. */
  const retryFns = new Map<string, () => Promise<unknown>>();

  let saveErrors = $state<Record<string, string>>({});

  const keyOf = (uri: string, playerId: number) => `${uri}|${playerId}`;

  function clearError(k: string) {
    if (!(k in saveErrors)) return;
    const next = { ...saveErrors };
    delete next[k];
    saveErrors = next;
  }

  /**
   * The one write. Returns whether the server accepted it.
   *
   * On rejection nothing is rolled back: the attempted value stays on screen
   * (README §"Rejected-write / desync") and the ember rail plus the row's
   * inline line say it did not save. The DOM only reconciles to the server on
   * the next successful reload — which is exactly why the optimistic edit is
   * written into `data` before the request rather than held in the row: a
   * Svelte 5 controlled input whose bound expression never changes will not
   * re-render, so a value that lives only in the DOM goes stale forever
   * (commits 13f99a6, 12680fb).
   */
  async function sendPatch(
    targetRoundId: number,
    spotifyUri: string,
    playerId: number,
    patch: CandidatePatch,
  ): Promise<boolean> {
    const k = keyOf(spotifyUri, playerId);
    // Registered BEFORE the request so a failure always leaves a working
    // `retry now`. A recovered STATUS write must still reload: availability
    // and the ledger are server-derived, and the first-try path reloads too.
    retryFns.set(k, async () => {
      const ok = await sendPatch(targetRoundId, spotifyUri, playerId, patch);
      if (ok && patch.status !== undefined) await onchanged?.();
    });
    try {
      const res = await fetch(`/api/guess/${targetRoundId}/candidate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri, playerId, patch }),
      });
      if (!res.ok) {
        saveErrors = { ...saveErrors, [k]: `couldn't save (${res.status})` };
        return false;
      }
    } catch {
      saveErrors = { ...saveErrors, [k]: `couldn't save` };
      return false;
    }
    clearError(k);
    retryFns.delete(k);
    return true;
  }

  /** Optimistic local edit + per-(song, player) 400ms debounced PATCH. */
  function queueEdit(song: WorkspaceSong, c: Candidate, patch: CandidatePatch) {
    Object.assign(c, patch); // `data` is the host's deep $state proxy — reactive.

    const k = keyOf(song.spotifyUri, c.playerId);
    pendingPatch.set(k, { ...(pendingPatch.get(k) ?? {}), ...patch });

    const targetRoundId = roundId; // capture now — the live prop may change before the timer fires
    const { spotifyUri } = song;
    const { playerId } = c;

    const existing = saveTimers.get(k);
    if (existing) clearTimeout(existing.timer);

    const fire = async () => {
      const merged = pendingPatch.get(k);
      if (!merged) return;
      pendingPatch.delete(k);
      await sendPatch(targetRoundId, spotifyUri, playerId, merged);
    };
    saveTimers.set(k, {
      timer: setTimeout(() => {
        saveTimers.delete(k);
        void fire();
      }, 400),
      fire,
    });
  }

  /**
   * Fire every pending debounced save immediately and await them. Must run
   * before any reload (the reload replaces `data`, and a save still sitting
   * behind the debounce would be silently discarded) and on unmount.
   */
  async function flushPendingSaves(): Promise<void> {
    const fires: Promise<void>[] = [];
    for (const [k, pending] of saveTimers) {
      clearTimeout(pending.timer);
      fires.push(pending.fire());
      saveTimers.delete(k);
    }
    await Promise.all(fires);
  }

  // Flush (not drop) on round change and on destroy, same as VotingLab.
  $effect(() => {
    void roundId;
    return () => {
      void flushPendingSaves();
    };
  });

  /**
   * The host's flush handle (SearchBar.svelte's `export function` + `bind:this`
   * idiom). "Flush before any reload" is only enforceable inside this component
   * for reloads this component triggers; the host has its own — the rehearsal
   * controls, which are reachable the whole time the board is mounted. Without
   * this, `archiveRehearsal` DELETEs every guess for the round and a PATCH
   * queued under 400ms earlier lands afterwards, re-creating the row through
   * setCandidate's INSERT OR IGNORE. Same class as commit ad6a37f.
   */
  export async function flush(): Promise<void> {
    await flushPendingSaves();
  }

  /**
   * Status writes fire IMMEDIATELY — they have grid-wide consequences
   * (availability everywhere else) that must not lag behind a debounce — and
   * are followed by a reload so availability is re-read server-side rather
   * than guessed here. A rejected status write does not reload: the attempted
   * state stays visible under the ember rail, per the design.
   */
  async function cycleStatus(song: WorkspaceSong, c: Candidate, next: CandidateStatus) {
    // Optimistic; deliberately NOT rolled back on failure. Known and accepted:
    // a rejected status therefore feeds rollup()/findConflicts() until the next
    // successful reload, so the roll-up line can briefly count a lock the
    // server never took. The ember rail says the row did not save, and the
    // alternative — snapping the chip back — is the desync bug this design
    // exists to avoid. Behaviour intentionally unchanged.
    c.status = next;
    await flushPendingSaves();
    const ok = await sendPatch(roundId, song.spotifyUri, c.playerId, { status: next });
    if (!ok) return;
    await onchanged?.();
  }

  /**
   * The DELETE. Like sendPatch, it registers ITSELF as the row's retry before
   * firing — otherwise `retry now` on a failed remove would re-fire the last
   * PATCH for that key, and that patch's success would `clearError` and wipe
   * "couldn't remove" while the row is still sitting there: silent false
   * reassurance on a destructive action.
   */
  async function sendDelete(
    targetRoundId: number,
    spotifyUri: string,
    playerId: number,
  ): Promise<boolean> {
    const k = keyOf(spotifyUri, playerId);
    retryFns.set(k, async () => {
      if (await sendDelete(targetRoundId, spotifyUri, playerId)) await onchanged?.();
    });
    try {
      const res = await fetch(`/api/guess/${targetRoundId}/candidate`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri, playerId }),
      });
      if (!res.ok) {
        saveErrors = { ...saveErrors, [k]: `couldn't remove (${res.status})` };
        return false;
      }
    } catch {
      saveErrors = { ...saveErrors, [k]: `couldn't remove` };
      return false;
    }
    clearError(k);
    retryFns.delete(k);
    return true;
  }

  async function removeCandidate(song: WorkspaceSong, c: Candidate) {
    const k = keyOf(song.spotifyUri, c.playerId);
    // Drop any queued edit for a row that is about to cease to exist, then
    // flush whatever else is pending BEFORE the delete — a PATCH that landed
    // after it would re-create the row via setCandidate's INSERT OR IGNORE.
    const pending = saveTimers.get(k);
    if (pending) clearTimeout(pending.timer);
    saveTimers.delete(k);
    pendingPatch.delete(k);
    await flushPendingSaves();

    if (await sendDelete(roundId, song.spotifyUri, c.playerId)) await onchanged?.();
  }

  function retry(spotifyUri: string, playerId: number) {
    const fn = retryFns.get(keyOf(spotifyUri, playerId));
    if (fn) void fn();
  }

  // ===== row order ======================================================

  /** Bumped when a row collapses, to re-settle order after a certainty edit. */
  let orderEpoch = $state(0);

  /**
   * Row order for one song: sortCandidates, but with `certainty` read OUTSIDE
   * the reactive graph.
   *
   * `sortCandidates(song.candidates)` in the {#each} expression made the
   * comparator's `a.certainty` read a dependency, so the optimistic assign on
   * every slider tick re-ran the sort and the keyed each moved the row's DOM
   * node MID-DRAG. Verified in Chromium: the drag itself survives the move
   * (pointer capture stays on the input), so this is not a correctness break —
   * but the row and its open editor jump out from under the cursor, which is
   * not a thing to ship.
   *
   * untrack() on certainty alone keeps the block reactive to what SHOULD
   * reorder — the candidate set, and `status`, the primary key, whose chip
   * fires immediately by design — while a certainty drag holds still. Order
   * re-settles on the next reload, or when the row collapses (orderEpoch),
   * which is the user's own "done here" signal and cannot fire mid-drag.
   *
   * The sort runs on cheap key objects but returns the LIVE candidate objects:
   * the whole desync guarantee rests on the rows being the same references the
   * bindings read, so this must never hand back clones.
   */
  function rowOrder(song: WorkspaceSong): Candidate[] {
    void orderEpoch;
    const live = new Map(song.candidates.map((c) => [c.playerId, c]));
    const keys: Candidate[] = song.candidates.map((c) => ({
      playerId: c.playerId,
      status: c.status,
      certainty: untrack(() => c.certainty),
      factors: '',
      notes: '',
    }));
    return sortCandidates(keys).map((k) => live.get(k.playerId) as Candidate);
  }

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

  /** The `⚠ <Name> locked twice` marker, when this song is half of a duplicate. */
  function conflictTag(song: WorkspaceSong): string | null {
    for (const c of song.candidates) {
      if (c.status === 'locked' && conflicts.has(c.playerId)) {
        return `⚠ ${nameFor(c.playerId)} locked twice`;
      }
    }
    return null;
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
          {#each rowOrder(song) as c (c.playerId)}
            <CandidateRow
              candidate={c}
              name={nameFor(c.playerId)}
              availability={commitmentElsewhere(data, c.playerId, song.spotifyUri)}
              error={saveErrors[keyOf(song.spotifyUri, c.playerId)] ?? null}
              onedit={(patch) => queueEdit(song, c, patch)}
              oncycle={(next) => cycleStatus(song, c, next)}
              onremove={() => removeCandidate(song, c)}
              onretry={() => retry(song.spotifyUri, c.playerId)}
              onsettle={() => (orderEpoch += 1)}
            />
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <!-- ===== LEDGER (Task 7 fills this) ===== -->
  <div></div>
</div>
