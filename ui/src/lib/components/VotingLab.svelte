<script lang="ts">
  import type { BallotEntry, LabData } from '$lib/voting-lab/types.js';
  import { canAllocate, computeUsage, validateBallot } from '$lib/voting-lab/budget.js';
  import VotingLabSongRow from './VotingLabSongRow.svelte';

  let { roundId }: { roundId: number } = $props();

  let data = $state<LabData | null>(null);
  let loadError = $state<string | null>(null);

  async function load() {
    loadError = null;
    const res = await fetch(`/api/voting-lab/${roundId}`);
    if (!res.ok) { loadError = `Failed to load lab (${res.status})`; return; }
    data = (await res.json()) as LabData;
  }

  $effect(() => { void roundId; void load(); });

  let syncing = $state(false);
  let syncMsg = $state<string | null>(null);

  async function syncLive() {
    syncing = true;
    syncMsg = null;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/sync`, { method: 'POST' });
      const body = await res.json();
      if (res.ok) {
        syncMsg = body.message
          ? body.message
          : `Loaded: ${body.inserted} new, ${body.skipped} already had.`;
        await load();
      } else {
        syncMsg = body.message ?? `Load failed (${res.status})`;
      }
    } finally {
      syncing = false;
    }
  }

  const usage = $derived(
    data ? computeUsage(data.rows.map((r) => r.ballot), data.budget) : null,
  );

  let saveError = $state<string | null>(null);

  type PendingSave = { timer: ReturnType<typeof setTimeout>; fire: () => Promise<void> };
  const saveTimers = new Map<string, PendingSave>();

  function canAlloc(uri: string, kind: 'up' | 'down', delta: number): boolean {
    if (!data) return false;
    return canAllocate(data.rows.map((r) => r.ballot), data.budget, uri, kind, delta);
  }

  /** Perform the PATCH against the round id captured when the save was scheduled. */
  async function sendBallot(targetRoundId: number, entry: BallotEntry): Promise<void> {
    try {
      const res = await fetch(`/api/voting-lab/${targetRoundId}/ballot`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        saveError = `Failed to save "${entry.spotifyUri}" (${res.status})`;
        return;
      }
      saveError = null;
    } catch {
      saveError = `Failed to save "${entry.spotifyUri}" (network error)`;
    }
  }

  /**
   * Fire any pending debounced save immediately and await it — e.g. before
   * the round changes, or before a "Draft comment" request that reads the
   * ballot back out of the DB (the draft endpoint would otherwise see
   * stale notes/rating/allocation still sitting behind the 400ms debounce).
   */
  async function flushPendingSaves(): Promise<void> {
    const pendingFires: Promise<void>[] = [];
    for (const [uri, pending] of saveTimers) {
      clearTimeout(pending.timer);
      pendingFires.push(pending.fire());
      saveTimers.delete(uri);
    }
    await Promise.all(pendingFires);
  }

  /** Update local state immediately, then debounce the PATCH per song. */
  function applyBallot(next: BallotEntry) {
    if (!data) return;
    data.rows = data.rows.map((r) =>
      r.song.spotifyUri === next.spotifyUri ? { ...r, ballot: next } : r,
    );
    const targetRoundId = roundId; // capture now — the live prop may change before the timer fires
    const existing = saveTimers.get(next.spotifyUri);
    if (existing) clearTimeout(existing.timer);
    const fire = () => sendBallot(targetRoundId, next);
    saveTimers.set(next.spotifyUri, {
      timer: setTimeout(() => {
        saveTimers.delete(next.spotifyUri);
        fire();
      }, 400),
      fire,
    });
  }

  // Flush (not drop) any pending save whenever roundId changes, and on destroy —
  // otherwise a stale timer would PATCH the previous round's data to the new round's endpoint.
  $effect(() => {
    void roundId;
    return () => { flushPendingSaves(); };
  });

  /**
   * PUT the current budget as a per-round override. Reuses `saveError` (the
   * same failure surface as ballot saves) rather than a separate mechanism.
   * On success, budgetSource flips to 'round' so the label reflects the
   * override immediately.
   */
  async function saveBudget() {
    if (!data) return;
    try {
      const res = await fetch(`/api/voting-lab/${roundId}/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.budget),
      });
      if (!res.ok) {
        saveError = `Failed to save budget (${res.status})`;
        return;
      }
      saveError = null;
      data.budgetSource = 'round';
    } catch {
      saveError = 'Failed to save budget (network error)';
    }
  }

  // Sanitize on commit (onchange, not oninput) so a momentarily-blank/NaN
  // input never reaches the endpoint — mirrors the clamp used for the
  // season-level budget editor in settings/+page.svelte.
  function setUpTotal(raw: string) {
    if (!data) return;
    const n = Math.max(0, Math.round(Number(raw) || 0));
    data.budget = { ...data.budget, upTotal: n };
    saveBudget();
  }

  function setDownTotal(raw: string) {
    if (!data) return;
    const n = Math.max(0, Math.round(Number(raw) || 0));
    data.budget = { ...data.budget, downTotal: n };
    saveBudget();
  }

  // Blank means "no cap" (null), not 0 — mirrors the per-song-cap clamp used
  // for the season-level budget editor in settings/+page.svelte.
  function setPerSongCap(raw: string) {
    if (!data) return;
    const trimmed = raw.trim();
    const n = trimmed === '' ? null : Math.max(1, Math.round(Number(trimmed) || 1));
    data.budget = { ...data.budget, perSongCap: n };
    saveBudget();
  }

  const problems = $derived(
    data ? validateBallot(data.rows.map((r) => r.ballot), data.budget) : [],
  );

  /**
   * The text you paste into Music League. Never includes submitter identity —
   * only song metadata and the voter's own allocation/comment.
   */
  function ballotText(): string {
    if (!data) return '';
    const songLines: string[] = [];
    for (const r of data.rows) {
      const { upPoints, downPoints, draftComment } = r.ballot;
      if (upPoints === 0 && downPoints === 0) continue;
      let pts: string;
      if (upPoints > 0 && downPoints > 0) {
        pts = `+${upPoints} / -${downPoints}`;
      } else if (downPoints > 0) {
        pts = `-${downPoints}`;
      } else {
        pts = `+${upPoints}`;
      }
      songLines.push(`${pts}  ${r.song.artist} — ${r.song.title}`);
      if (draftComment) songLines.push(`     "${draftComment}"`);
    }
    if (songLines.length === 0) return '';
    return [`${data.themeName}`, '', ...songLines].join('\n');
  }

  let copied = $state(false);
  let copyError = $state<string | null>(null);
  async function copyBallot() {
    try {
      await navigator.clipboard.writeText(ballotText());
      copyError = null;
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copyError = 'Failed to copy — select and copy the text manually.';
    }
  }
</script>

<section class="voting-lab">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <h2 class="font-display text-lg font-semibold">Voting Lab</h2>
    {#if usage && data}
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span
          class:text-ember={usage.upRemaining < 0}
          class:text-amber={usage.upRemaining === 0}
        >
          Up: <span class="font-mono tabular-nums">{usage.upUsed}</span>/
        </span>
        <input
          type="number"
          min="0"
          class="w-14 rounded bg-bg-elevated px-1 font-mono tabular-nums"
          value={data.budget.upTotal}
          onchange={(e) => setUpTotal(e.currentTarget.value)}
        />
        <span
          class:text-ember={usage.upRemaining < 0}
          class:text-amber={usage.upRemaining === 0}
        >
          &middot; <span class="font-mono tabular-nums">{usage.upRemaining}</span> left
        </span>
        <span
          class:text-ember={usage.downRemaining < 0}
          class:text-amber={usage.downRemaining === 0}
        >
          Down: <span class="font-mono tabular-nums">{usage.downUsed}</span>/
        </span>
        <input
          type="number"
          min="0"
          class="w-14 rounded bg-bg-elevated px-1 font-mono tabular-nums"
          value={data.budget.downTotal}
          onchange={(e) => setDownTotal(e.currentTarget.value)}
        />
        <span
          class:text-ember={usage.downRemaining < 0}
          class:text-amber={usage.downRemaining === 0}
        >
          &middot; <span class="font-mono tabular-nums">{usage.downRemaining}</span> left
        </span>
        <span class="font-mono text-[10px] uppercase tracking-wide text-fg-dim">cap/song</span>
        <!-- Deferred: a future split into separate upCap/downCap would go here (not wanted today — up-cap > down-cap makes it moot). -->
        <input
          type="number"
          min="1"
          placeholder="none"
          class="w-14 rounded bg-bg-elevated px-1 font-mono tabular-nums"
          value={data.budget.perSongCap ?? ''}
          onchange={(e) => setPerSongCap(e.currentTarget.value)}
        />
        <span class="text-fg-dim">({data.budgetSource})</span>
      </div>
    {/if}
    {#if data?.phase === 'voting'}
      <button
        class="rounded border border-border px-2 py-1 text-xs"
        onclick={syncLive}
        disabled={syncing}
      >
        {syncing ? 'Loading…' : 'Load playlist'}
      </button>
    {/if}
  </header>

  {#if syncMsg}<p class="text-xs text-fg-muted">{syncMsg}</p>{/if}

  {#if saveError}
    <p class="text-sm text-ember">{saveError}</p>
  {/if}

  {#if loadError}
    <p class="text-ember">{loadError}</p>
  {:else if !data}
    <p class="text-fg-dim">Loading…</p>
  {:else}
    <p class="mt-1 font-display text-sm text-fg-muted">{data.themeName}</p>
    <ul class="mt-3 space-y-2">
      {#each data.rows as row (row.song.submissionId)}
        <VotingLabSongRow {row} {roundId} {canAlloc} onchange={applyBallot} flushSaves={flushPendingSaves} />
      {/each}
    </ul>

    <footer class="mt-4 border-t border-border-muted pt-3">
      {#if problems.length}
        <ul class="mb-2 text-sm text-ember">
          {#each problems as p}<li>{p}</li>{/each}
        </ul>
      {/if}
      <pre class="whitespace-pre-wrap rounded bg-bg-elevated p-2 text-sm">{ballotText() || 'No votes allocated yet.'}</pre>
      <button class="mt-2 rounded border border-border px-3 py-1 text-sm" onclick={copyBallot}>
        {copied ? 'Copied!' : 'Copy whole ballot'}
      </button>
      {#if copyError}
        <p class="mt-1 text-sm text-ember">{copyError}</p>
      {/if}
    </footer>
  {/if}
</section>
