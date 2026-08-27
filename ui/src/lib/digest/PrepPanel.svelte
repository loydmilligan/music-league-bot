<script lang="ts">
  /**
   * Pre-generation material for a round: what exists to build the digest from.
   *
   * Sits below the prep-checks list on the prepare stage and answers a
   * different question — checks ask "is the data imported?", this asks "what
   * material do we hold?". Same visual language on purpose.
   *
   * Also carries two editorial affordances that live on this panel rather
   * than in the generate modal because they are durable, not per-generation:
   *  - per-row editor notes (roundNotes.ts) — observations jotted mid-round
   *    that travel server-side into the prompt at generation time.
   *  - the early lede sheet (earlyLedes.ts) — a provisional, steering-only
   *    pass over what exists before votes/results, drafted on demand.
   */
  import type { MaterialRow } from './prepMaterial.js';
  import type { EarlyLede } from './earlyLedes.js';

  let { material, roundId }: { material: MaterialRow[]; roundId: number } = $props();

  let open = $state<Record<string, boolean>>({});
  const toggle = (id: string) => { open = { ...open, [id]: !open[id] }; };

  function glyph(status: MaterialRow['status']): string {
    return status === 'present' ? '✓' : status === 'not-enabled' ? '–' : '!';
  }
  function colour(status: MaterialRow['status']): string {
    return status === 'present' ? 'var(--moss)'
      : status === 'not-enabled' ? 'var(--fg-quiet)' : 'var(--amber)';
  }
  const presentCount = $derived(material.filter((m) => m.status === 'present').length);

  // ---------------------------------------------------------------------
  // Notes (Task 6, Step 5)
  //
  // Mirrors roundNotes.ts's NoteTarget without importing that server module
  // client-side (it pulls in node:crypto).
  // ---------------------------------------------------------------------
  type NoteTarget =
    | 'general' | 'podium' | 'villain' | 'flow' | 'consensus' | 'quotes' | 'chat' | 'storylines' | 'ledes';
  const NOTE_TARGETS: NoteTarget[] =
    ['general', 'podium', 'villain', 'flow', 'consensus', 'quotes', 'chat', 'storylines', 'ledes'];

  type RoundNote = {
    id: string; roundId: number; target: NoteTarget; body: string;
    createdAt: string; updatedAt: string;
  };

  /** Which target a note added from a given material row defaults to. */
  const DEFAULT_TARGET: Record<string, NoteTarget> = {
    bridge: 'general', 'early-ledes': 'ledes', chat: 'chat',
    storylines: 'storylines', guesser: 'general', participation: 'general',
  };
  const targetFor = (rowId: string): NoteTarget => DEFAULT_TARGET[rowId] ?? 'general';

  // Which row exclusively displays notes for a given target. The select in
  // each note offers all nine NOTE_TARGETS, but only three rows have a
  // material row uniquely tied to their target — a note retargeted to any
  // other target (podium/villain/flow/consensus/quotes, or general) has no
  // row of its own. The 'bridge' row is the general/orphan row: it shows its
  // own 'general' notes plus every note whose target isn't claimed by one of
  // the rows below, so every note is visible on exactly one row.
  const ROW_TARGETS: Record<string, NoteTarget> = {
    'early-ledes': 'ledes', chat: 'chat', storylines: 'storylines',
  };
  const ORPHAN_ROW_ID = 'bridge';
  const CLAIMED_TARGETS = new Set<NoteTarget>(Object.values(ROW_TARGETS));

  let notes = $state<RoundNote[]>([]);
  let noteDrafts = $state<Record<string, string>>({});
  let noteBusy = $state<Record<string, boolean>>({});
  let editingNoteId = $state<string | null>(null);
  let editDraft = $state('');

  async function loadNotes() {
    try {
      const res = await fetch(`/api/digest/${roundId}/notes`);
      if (res.ok) notes = ((await res.json()) as { notes?: RoundNote[] }).notes ?? [];
    } catch {
      // leave notes as-is; the panel still works without them
    }
  }

  $effect(() => { void roundId; loadNotes(); });

  function notesForRow(rowId: string): RoundNote[] {
    const ownTarget = ROW_TARGETS[rowId];
    if (ownTarget) return notes.filter((n) => n.target === ownTarget);
    if (rowId === ORPHAN_ROW_ID) return notes.filter((n) => !CLAIMED_TARGETS.has(n.target));
    // Rows without a unique target (guesser, participation) never display
    // notes themselves — those notes surface on the orphan row instead, so
    // each note appears on exactly one row.
    return [];
  }

  async function addNote(rowId: string) {
    const body = (noteDrafts[rowId] ?? '').trim();
    if (!body) return;
    noteBusy = { ...noteBusy, [`add:${rowId}`]: true };
    try {
      const res = await fetch(`/api/digest/${roundId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: targetFor(rowId), body }),
      });
      if (res.ok) {
        const { note } = (await res.json()) as { note: RoundNote };
        notes = [...notes, note];
        noteDrafts = { ...noteDrafts, [rowId]: '' };
      }
    } finally {
      noteBusy = { ...noteBusy, [`add:${rowId}`]: false };
    }
  }

  function startEdit(note: RoundNote) {
    editingNoteId = note.id;
    editDraft = note.body;
  }
  function cancelEdit() {
    editingNoteId = null;
    editDraft = '';
  }

  async function saveEdit(note: RoundNote) {
    const body = editDraft.trim();
    if (!body) return;
    noteBusy = { ...noteBusy, [note.id]: true };
    try {
      const res = await fetch(`/api/digest/${roundId}/notes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: note.id, body }),
      });
      if (res.ok) {
        const { note: updated } = (await res.json()) as { note: RoundNote };
        notes = notes.map((n) => (n.id === updated.id ? updated : n));
        editingNoteId = null;
        editDraft = '';
      }
    } finally {
      noteBusy = { ...noteBusy, [note.id]: false };
    }
  }

  async function retargetNote(note: RoundNote, target: NoteTarget) {
    if (target === note.target) return;
    noteBusy = { ...noteBusy, [note.id]: true };
    try {
      const res = await fetch(`/api/digest/${roundId}/notes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: note.id, target }),
      });
      if (res.ok) {
        const { note: updated } = (await res.json()) as { note: RoundNote };
        notes = notes.map((n) => (n.id === updated.id ? updated : n));
      }
    } finally {
      noteBusy = { ...noteBusy, [note.id]: false };
    }
  }

  async function deleteNote(note: RoundNote) {
    noteBusy = { ...noteBusy, [note.id]: true };
    try {
      const res = await fetch(`/api/digest/${roundId}/notes`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: note.id }),
      });
      if (res.ok) notes = notes.filter((n) => n.id !== note.id);
    } finally {
      noteBusy = { ...noteBusy, [note.id]: false };
    }
  }

  // ---------------------------------------------------------------------
  // Early lede sheet (Task 8, Step 3)
  // ---------------------------------------------------------------------
  type EarlyLedeRating = 'love' | 'keep' | 'kill';
  const RATINGS: EarlyLedeRating[] = ['love', 'keep', 'kill'];

  let earlyLedes = $state<EarlyLede[]>([]);
  let earlyLedeRatings = $state<Record<string, EarlyLedeRating>>({});
  let earlyLedeSheetLoaded = $state(false);
  let draftingLedes = $state(false);

  async function loadEarlyLedes() {
    try {
      const res = await fetch(`/api/digest/${roundId}/early-ledes`);
      if (res.ok) {
        const { sheet } = (await res.json()) as {
          sheet: { ledes: EarlyLede[]; ratings: unknown } | null;
        };
        if (sheet) {
          earlyLedes = sheet.ledes ?? [];
          earlyLedeRatings =
            sheet.ratings && typeof sheet.ratings === 'object'
              ? (sheet.ratings as Record<string, EarlyLedeRating>)
              : {};
          earlyLedeSheetLoaded = true;
        }
      }
    } catch {
      // leave the sheet absent; the Draft button still works
    }
  }

  $effect(() => { void roundId; loadEarlyLedes(); });

  async function draftEarlyLedes() {
    draftingLedes = true;
    try {
      const res = await fetch(`/api/digest/${roundId}/early-ledes`, { method: 'POST' });
      if (res.ok) {
        const body = (await res.json()) as { ledes: EarlyLede[] };
        earlyLedes = body.ledes ?? [];
        earlyLedeSheetLoaded = true;
        // A regeneration keeps the editor's ratings server-side — refresh to
        // pick them back up rather than assuming they carried over locally.
        await loadEarlyLedes();
      }
    } finally {
      draftingLedes = false;
    }
  }

  async function rateLede(lede: EarlyLede, rating: EarlyLedeRating) {
    const next = { ...earlyLedeRatings };
    if (next[lede.id] === rating) delete next[lede.id];
    else next[lede.id] = rating;
    earlyLedeRatings = next;
    try {
      await fetch(`/api/digest/${roundId}/early-ledes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ratings: earlyLedeRatings }),
      });
    } catch {
      // rating is still reflected locally; a later save will retry
    }
  }
</script>

<div class="dg-prep-material">
  <header class="dg-prep-material-hd">
    <span class="dg-prep-material-label">
      Pre-generation material · {presentCount}/{material.length}
    </span>
  </header>

  <div class="dg-prep-material-list">
    {#each material as row (row.id)}
      <div class="dg-prep-material-row">
        <span class="dg-prep-material-glyph" style="color: {colour(row.status)};">
          {glyph(row.status)}
        </span>
        <span class="dg-prep-material-name">
          {row.name}{row.count !== undefined ? ` · ${row.count}` : ''}
          {#if row.status === 'not-enabled'}<em> (not enabled for this league)</em>{/if}
        </span>
        <span class="dg-prep-material-src">{row.src}</span>
        {#if row.id !== 'early-ledes' && row.preview !== undefined}
          <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                  onclick={() => toggle(row.id)}>
            {open[row.id] ? 'hide' : 'preview'}
          </button>
        {/if}
      </div>
      {#if row.id !== 'early-ledes' && open[row.id] && row.preview !== undefined}
        <pre class="dg-prep-material-preview">{JSON.stringify(row.preview, null, 2)}</pre>
      {/if}

      {#if row.id === 'early-ledes'}
        <div class="dg-prep-ledes">
          <div class="dg-prep-ledes-hd">
            <span class="dg-prep-ledes-caveat">
              drafted without votes or results — steering only
            </span>
            <button
              type="button"
              class="mash-btn mash-btn--secondary mash-btn--sm"
              disabled={draftingLedes}
              onclick={draftEarlyLedes}
            >
              {#if draftingLedes}
                <span class="dg-prep-spinner" aria-hidden="true"></span> Drafting…
              {:else}
                {earlyLedeSheetLoaded ? 'Redraft' : 'Draft early ledes'}
              {/if}
            </button>
          </div>
          {#if earlyLedeSheetLoaded && earlyLedes.length}
            <ul class="dg-prep-ledes-list">
              {#each earlyLedes as lede (lede.id)}
                <li class="dg-prep-lede">
                  <div class="dg-prep-lede-body">
                    <span class="dg-prep-lede-title">{lede.title}</span>
                    <span class="dg-prep-lede-angle">{lede.angle}</span>
                    {#if lede.evidence?.length}
                      <ul class="dg-prep-lede-evidence">
                        {#each lede.evidence as e, i (i)}
                          <li>{e}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                  <div class="dg-prep-lede-rate" role="group" aria-label="Rate this lede">
                    {#each RATINGS as rating (rating)}
                      <button
                        type="button"
                        class="mash-btn mash-btn--ghost mash-btn--sm"
                        class:is-on={earlyLedeRatings[lede.id] === rating}
                        onclick={() => rateLede(lede, rating)}
                      >{rating}</button>
                    {/each}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="dg-prep-notes">
        {#each notesForRow(row.id) as note (note.id)}
          <div class="dg-prep-note">
            {#if editingNoteId === note.id}
              <textarea
                class="dg-prep-note-edit"
                bind:value={editDraft}
                disabled={noteBusy[note.id]}
              ></textarea>
              <div class="dg-prep-note-actions">
                <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm"
                        disabled={noteBusy[note.id]} onclick={() => saveEdit(note)}>save</button>
                <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                        disabled={noteBusy[note.id]} onclick={cancelEdit}>cancel</button>
              </div>
            {:else}
              <span class="dg-prep-note-body">{note.body}</span>
              <select
                class="dg-prep-note-target"
                value={note.target}
                disabled={noteBusy[note.id]}
                onchange={(e) => retargetNote(note, e.currentTarget.value as NoteTarget)}
                aria-label="Note target"
              >
                {#each NOTE_TARGETS as t (t)}
                  <option value={t}>{t}</option>
                {/each}
              </select>
              <div class="dg-prep-note-actions">
                <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                        disabled={noteBusy[note.id]} onclick={() => startEdit(note)}>edit</button>
                <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                        disabled={noteBusy[note.id]} onclick={() => deleteNote(note)}>delete</button>
              </div>
            {/if}
          </div>
        {/each}
        <div class="dg-prep-note-add">
          <textarea
            class="dg-prep-note-input"
            placeholder="Add a note for this round…"
            value={noteDrafts[row.id] ?? ''}
            oninput={(e) => (noteDrafts = { ...noteDrafts, [row.id]: e.currentTarget.value })}
            disabled={noteBusy[`add:${row.id}`]}
          ></textarea>
          <button
            type="button"
            class="mash-btn mash-btn--secondary mash-btn--sm"
            disabled={noteBusy[`add:${row.id}`] || !(noteDrafts[row.id] ?? '').trim()}
            onclick={() => addNote(row.id)}
          >Add note</button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .dg-prep-material { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-hd { display: flex; justify-content: space-between; align-items: baseline; }
  .dg-prep-material-label { font: 600 11px/1 var(--font-mono); color: var(--fg-quiet); text-transform: uppercase; letter-spacing: 0.04em; }
  .dg-prep-material-list { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-row {
    display: grid; grid-template-columns: 22px 1fr auto auto; gap: 12px; align-items: baseline;
    padding: 8px 10px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-material-glyph { text-align: center; font: 700 14px/1 var(--font-mono); }
  .dg-prep-material-name { font: 500 13px/1.4 var(--font-body); color: var(--fg); }
  .dg-prep-material-name em { color: var(--fg-quiet); font-style: normal; }
  .dg-prep-material-src { font: 500 11px/1 var(--font-mono); color: var(--fg-quiet); }
  .dg-prep-material-preview {
    margin: 0 0 4px; padding: 10px 12px; background: var(--ink-0);
    border: 1px solid var(--line); border-radius: var(--r-2);
    font: 500 11px/1.5 var(--font-mono); color: var(--fg-quiet);
    max-height: 320px; overflow: auto; white-space: pre-wrap;
  }

  /* Early lede sheet */
  .dg-prep-ledes {
    display: flex; flex-direction: column; gap: 8px;
    margin: 0 0 4px; padding: 10px 12px; background: var(--ink-0);
    border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-ledes-hd { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .dg-prep-ledes-caveat { font: 500 11px/1.3 var(--font-mono); color: var(--fg-quiet); font-style: italic; }
  .dg-prep-ledes-list { display: flex; flex-direction: column; gap: 8px; list-style: none; margin: 0; padding: 0; }
  .dg-prep-lede {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
    padding: 8px; background: var(--ink-1, var(--ink-0)); border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-lede-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dg-prep-lede-title { font: 600 12px/1.3 var(--font-body); color: var(--fg); }
  .dg-prep-lede-angle { font: 500 12px/1.4 var(--font-body); color: var(--fg-quiet); }
  .dg-prep-lede-evidence { margin: 4px 0 0; padding-left: 16px; font: 500 11px/1.4 var(--font-mono); color: var(--fg-quiet); }
  .dg-prep-lede-rate { display: flex; gap: 4px; flex-shrink: 0; }
  .dg-prep-lede-rate .is-on { background: var(--mash-pulp, var(--line)); color: var(--fg); }
  .dg-prep-spinner {
    display: inline-block; width: 9px; height: 9px; margin-right: 4px;
    border: 2px solid var(--line); border-top-color: var(--fg-quiet);
    border-radius: 50%; animation: dg-prep-spin 0.7s linear infinite;
  }
  @keyframes dg-prep-spin { to { transform: rotate(360deg); } }

  /* Notes */
  .dg-prep-notes { display: flex; flex-direction: column; gap: 6px; margin: 0 0 4px; padding-left: 4px; }
  .dg-prep-note {
    display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap;
    padding: 6px 8px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-note-body { flex: 1 1 auto; min-width: 120px; font: 500 12px/1.4 var(--font-body); color: var(--fg); white-space: pre-wrap; }
  .dg-prep-note-target { font: 500 11px/1 var(--font-mono); }
  .dg-prep-note-actions { display: flex; gap: 4px; }
  .dg-prep-note-edit { flex: 1 1 100%; min-height: 48px; font: 500 12px/1.4 var(--font-body); }
  .dg-prep-note-add { display: flex; gap: 8px; align-items: flex-start; }
  .dg-prep-note-input { flex: 1 1 auto; min-height: 32px; font: 500 12px/1.4 var(--font-body); resize: vertical; }
</style>
