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
  import type { WorkspaceData, WorkspaceSong } from '$lib/guessing/workspaceData.js';
  import type { Candidate, CandidateStatus } from '$lib/guessing/candidates.js';
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

  type CandidatePatch = {
    status?: CandidateStatus;
    certainty?: number | null;
    factors?: string;
    notes?: string;
  };
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
    retryFns.set(k, () => sendPatch(targetRoundId, spotifyUri, playerId, patch));
    try {
      const res = await fetch(`/api/guess/${targetRoundId}/candidate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri, playerId, patch }),
      });
      if (!res.ok) {
        saveErrors = { ...saveErrors, [k]: `couldn't save (${res.status}) — retrying` };
        return false;
      }
    } catch {
      saveErrors = { ...saveErrors, [k]: `couldn't save — retrying` };
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
   * Status writes fire IMMEDIATELY — they have grid-wide consequences
   * (availability everywhere else) that must not lag behind a debounce — and
   * are followed by a reload so availability is re-read server-side rather
   * than guessed here. A rejected status write does not reload: the attempted
   * state stays visible under the ember rail, per the design.
   */
  async function cycleStatus(song: WorkspaceSong, c: Candidate, next: CandidateStatus) {
    c.status = next; // optimistic; deliberately NOT rolled back on failure.
    await flushPendingSaves();
    const ok = await sendPatch(roundId, song.spotifyUri, c.playerId, { status: next });
    if (!ok) return;
    await onchanged?.();
  }

  async function removeCandidate(song: WorkspaceSong, c: Candidate) {
    const k = keyOf(song.spotifyUri, c.playerId);
    // Drop any queued edit for a row that is about to cease to exist, then
    // flush whatever else is pending before the reload.
    const pending = saveTimers.get(k);
    if (pending) clearTimeout(pending.timer);
    saveTimers.delete(k);
    pendingPatch.delete(k);
    await flushPendingSaves();

    try {
      const res = await fetch(`/api/guess/${roundId}/candidate`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spotifyUri: song.spotifyUri, playerId: c.playerId }),
      });
      if (!res.ok) {
        saveErrors = { ...saveErrors, [k]: `couldn't remove (${res.status})` };
        return;
      }
    } catch {
      saveErrors = { ...saveErrors, [k]: `couldn't remove — retrying` };
      return;
    }
    clearError(k);
    await onchanged?.();
  }

  function retry(spotifyUri: string, playerId: number) {
    const fn = retryFns.get(keyOf(spotifyUri, playerId));
    if (fn) void fn();
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
          {#each sortCandidates(song.candidates) as c (c.playerId)}
            <CandidateRow
              candidate={c}
              name={nameFor(c.playerId)}
              availability={commitmentElsewhere(data, c.playerId, song.spotifyUri)}
              error={saveErrors[keyOf(song.spotifyUri, c.playerId)] ?? null}
              onedit={(patch) => queueEdit(song, c, patch)}
              oncycle={(next) => cycleStatus(song, c, next)}
              onremove={() => removeCandidate(song, c)}
              onretry={() => retry(song.spotifyUri, c.playerId)}
            />
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <!-- ===== LEDGER (Task 7 fills this) ===== -->
  <div></div>
</div>
