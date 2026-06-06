<!--
  ActiveRounds — the active-round management surface (sprint-22 active-round-ui).
  One slot per active league showing its resolved active round (theme + dates).
  When a league is active but has NO resolvable active round, the slot shows a
  warning and a button that opens the "choose from list / create a new round"
  modal (D13). Self-contained: reads/writes the active-round-model API
  (GET /api/active-rounds, PUT/DELETE .../active-round, POST .../rounds) and
  patches each league in place from the refreshed view the API returns.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import StatusChip from '$lib/components/StatusChip.svelte';

  type Phase = 'upcoming' | 'submission' | 'voting' | 'archive';
  type AvailableRound = {
    id: number;
    name: string;
    phase: Phase;
    submissionDeadline: string | null;
    votingDeadline: string | null;
  };
  type ActiveRound = {
    id: number;
    name: string;
    theme: string | null;
    submissionDeadline: string | null;
    votingDeadline: string | null;
    phase: Phase;
    source: 'manual' | 'derived';
  };
  type LeagueActiveRound = {
    leagueId: number;
    slug: string;
    name: string;
    isActive: boolean;
    activeSeasonId: number | null;
    activeRound: ActiveRound | null;
    availableRounds: AvailableRound[];
  };

  let leagues = $state<LeagueActiveRound[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  // Modal state — the open league drives everything; null = closed.
  let modalLeague = $state<LeagueActiveRound | null>(null);
  let mode = $state<'choose' | 'create'>('choose');
  let formName = $state('');
  let formTheme = $state('');
  let formSub = $state(''); // <input type="datetime-local"> value (local time)
  let formVote = $state('');
  let saving = $state(false);
  let formError = $state<string | null>(null);

  onMount(load);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const res = await fetch('/api/active-rounds');
      if (!res.ok) throw new Error(`GET /api/active-rounds → ${res.status}`);
      const data = (await res.json()) as { leagues?: LeagueActiveRound[] };
      leagues = data.leagues ?? [];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'failed to load active rounds';
    } finally {
      loading = false;
    }
  }

  function replaceLeague(updated: LeagueActiveRound) {
    leagues = leagues.map((l) => (l.leagueId === updated.leagueId ? updated : l));
  }

  function openModal(l: LeagueActiveRound) {
    modalLeague = l;
    // Default to "choose" when there are rounds to pick; otherwise jump to create.
    mode = l.availableRounds.length > 0 ? 'choose' : 'create';
    formName = '';
    formTheme = '';
    formSub = '';
    formVote = '';
    formError = null;
    saving = false;
  }
  function closeModal() {
    modalLeague = null;
  }

  async function chooseRound(roundId: number) {
    if (!modalLeague) return;
    saving = true;
    formError = null;
    try {
      const res = await fetch(`/api/leagues/${modalLeague.leagueId}/active-round`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId }),
      });
      if (!res.ok) throw new Error((await res.text()) || `set active round → ${res.status}`);
      replaceLeague((await res.json()) as LeagueActiveRound);
      closeModal();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'failed to set active round';
    } finally {
      saving = false;
    }
  }

  async function createRound(e: SubmitEvent) {
    e.preventDefault();
    if (!modalLeague) return;
    if (!formName.trim()) {
      formError = 'A round theme / name is required.';
      return;
    }
    // datetime-local → full ISO so the server's Date.parse is unambiguous.
    const sub = formSub ? new Date(formSub).toISOString() : null;
    const vote = formVote ? new Date(formVote).toISOString() : null;
    if (sub && vote && Date.parse(vote) <= Date.parse(sub)) {
      formError = 'Voting deadline must be after the submission deadline.';
      return;
    }
    saving = true;
    formError = null;
    try {
      const res = await fetch(`/api/leagues/${modalLeague.leagueId}/rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          theme: formTheme.trim() || null,
          submission_deadline: sub,
          voting_deadline: vote,
          set_active: true, // becomes the slot in one call (per backend note)
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || `create round → ${res.status}`);
      const data = (await res.json()) as { league: LeagueActiveRound };
      replaceLeague(data.league);
      closeModal();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'failed to create round';
    } finally {
      saving = false;
    }
  }

  async function clearSlot(l: LeagueActiveRound) {
    const res = await fetch(`/api/leagues/${l.leagueId}/active-round`, { method: 'DELETE' });
    if (res.ok) replaceLeague((await res.json()) as LeagueActiveRound);
  }

  // ---- formatting helpers (browser-side; Date is fine here) ----
  function fmtDeadline(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function rel(iso: string | null): string | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return 'overdue';
    const h = Math.floor(ms / 3_600_000);
    if (h >= 24) return `in ${Math.floor(h / 24)}d`;
    if (h >= 1) return `in ${h}h`;
    return 'in <1h';
  }
  const phaseTone: Record<Phase, 'accent' | 'warn' | 'muted'> = {
    submission: 'accent',
    voting: 'warn',
    upcoming: 'muted',
    archive: 'muted',
  };

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && modalLeague) closeModal();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section class="bg-surface border border-border-muted rounded-xl p-6 mb-6">
  <header class="flex items-start gap-4 mb-5">
    <div class="flex-1 min-w-0">
      <h2 class="text-xl font-bold text-fg">Active rounds</h2>
      <p class="text-fg-muted text-sm mt-0.5">
        One slot per active league. Keep each league's active round accurate — pin a round or create one with deadlines.
      </p>
    </div>
    {#if !loading && leagues.length > 0}
      <StatusChip label={`${leagues.length} LEAGUE${leagues.length === 1 ? '' : 'S'}`} tone="accent" />
    {/if}
  </header>

  {#if loading}
    <p class="text-fg-faint font-mono text-sm italic">Loading active rounds…</p>
  {:else if loadError}
    <p class="text-warn font-mono text-sm">⚠ {loadError}</p>
  {:else if leagues.length === 0}
    <p class="text-fg-faint font-mono text-sm italic">
      No active leagues. Mark a league active from its page to track its round here.
    </p>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each leagues as l (l.leagueId)}
        {@const r = l.activeRound}
        <div
          class="bg-bg-elevated border rounded-xl p-4 flex flex-col min-w-0 overflow-hidden"
          class:border-border-muted={!!r}
          class:border-warn={!r}
        >
          <div class="flex items-center gap-2 mb-3 min-h-5 flex-wrap">
            {#if r}
              {#if r.phase === 'submission'}
                <StatusChip label="SUBMITTING" tone="accent" />
              {:else if r.phase === 'voting'}
                <StatusChip label="VOTING" tone="warn" />
              {:else if r.phase === 'upcoming'}
                <StatusChip label="UPCOMING" tone="muted" />
              {:else}
                <StatusChip label="ARCHIVE" tone="muted" />
              {/if}
              <StatusChip label={r.source} tone="muted" />
            {:else}
              <StatusChip label="NO ACTIVE ROUND" tone="warn" />
            {/if}
          </div>

          <div class="font-bold text-fg truncate" title={l.name}>{l.name}</div>

          {#if r}
            <div class="font-sans text-sm font-bold text-fg mt-1.5 truncate" title={r.theme ?? r.name}>
              {r.theme ?? r.name}
            </div>
            <dl class="mt-3 space-y-1 font-mono text-[11px] text-fg-dim">
              <div class="flex justify-between gap-2">
                <dt class="text-fg-faint flex-shrink-0">submissions</dt>
                <dd class="text-fg-muted truncate min-w-0 text-right">
                  {fmtDeadline(r.submissionDeadline)}{#if rel(r.submissionDeadline)} · {rel(r.submissionDeadline)}{/if}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-fg-faint flex-shrink-0">voting</dt>
                <dd class="text-fg-muted truncate min-w-0 text-right">
                  {fmtDeadline(r.votingDeadline)}{#if rel(r.votingDeadline)} · {rel(r.votingDeadline)}{/if}
                </dd>
              </div>
            </dl>
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-border-muted">
              <button
                type="button"
                class="font-mono text-[11px] uppercase tracking-wider text-accent hover:text-accent-strong transition-colors"
                onclick={() => openModal(l)}
              >
                Change
              </button>
              {#if r.source === 'manual'}
                <span class="text-fg-faint">·</span>
                <button
                  type="button"
                  class="font-mono text-[11px] uppercase tracking-wider text-fg-dim hover:text-fg transition-colors"
                  onclick={() => clearSlot(l)}
                >
                  Clear
                </button>
              {/if}
            </div>
          {:else}
            <p class="text-fg-muted text-sm mt-2 flex-1">
              This league is active but no active round could be resolved.
            </p>
            <button
              type="button"
              class="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors"
              onclick={() => openModal(l)}
            >
              Set active round
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<!-- Choose / create modal -->
{#if modalLeague}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    transition:fade={{ duration: 120 }}
  >
    <button
      type="button"
      class="absolute inset-0 bg-black/70"
      aria-label="Close"
      onclick={closeModal}
    ></button>
    <div
      class="relative w-full max-w-md bg-bg-elevated border border-border-muted rounded-xl shadow-xl max-h-[85vh] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Set active round for {modalLeague.name}"
    >
      <header class="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border-muted">
        <div class="min-w-0">
          <p class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
            {modalLeague.activeRound ? 'Change active round' : 'No active round'}
          </p>
          <h3 class="font-display text-lg font-bold text-fg truncate">{modalLeague.name}</h3>
        </div>
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 -mr-1 flex-shrink-0 rounded-sm text-fg-muted hover:text-fg hover:bg-surface transition-colors"
          aria-label="Close"
          onclick={closeModal}
        >
          <span class="text-lg leading-none" aria-hidden="true">✕</span>
        </button>
      </header>

      <!-- Mode toggle -->
      <div class="flex items-center gap-1 px-5 pt-4">
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-sm border-b-2 transition-colors"
          class:border-accent={mode === 'choose'}
          class:text-accent={mode === 'choose'}
          class:border-transparent={mode !== 'choose'}
          class:text-fg-muted={mode !== 'choose'}
          onclick={() => (mode = 'choose')}
        >
          Choose from list
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-sm border-b-2 transition-colors"
          class:border-accent={mode === 'create'}
          class:text-accent={mode === 'create'}
          class:border-transparent={mode !== 'create'}
          class:text-fg-muted={mode !== 'create'}
          onclick={() => (mode = 'create')}
        >
          Create new round
        </button>
      </div>

      <div class="px-5 py-4">
        {#if mode === 'choose'}
          {#if modalLeague.availableRounds.length === 0}
            <p class="text-fg-faint font-mono text-sm italic py-4">
              No rounds in this league's active season yet. Create one →
            </p>
          {:else}
            <ul class="flex flex-col gap-1.5">
              {#each modalLeague.availableRounds as ar (ar.id)}
                <li>
                  <button
                    type="button"
                    disabled={saving}
                    class="w-full text-left bg-surface border border-border-muted hover:border-accent-deep rounded-md px-3 py-2.5 transition-colors disabled:opacity-50"
                    onclick={() => chooseRound(ar.id)}
                  >
                    <div class="flex items-center gap-2">
                      <span class="flex-1 font-semibold text-sm text-fg truncate">{ar.name}</span>
                      <StatusChip label={ar.phase} tone={phaseTone[ar.phase]} />
                    </div>
                    <div class="font-mono text-[11px] text-fg-dim mt-1">
                      sub {fmtDeadline(ar.submissionDeadline)} · vote {fmtDeadline(ar.votingDeadline)}
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <form class="flex flex-col gap-3" onsubmit={createRound}>
            <label class="flex flex-col gap-1">
              <span class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">Theme / name *</span>
              <input
                type="text"
                bind:value={formName}
                placeholder="e.g. Songs about the ocean"
                class="bg-surface border border-border-muted focus:border-accent rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition-colors"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">Description (optional)</span>
              <input
                type="text"
                bind:value={formTheme}
                placeholder="A longer blurb for the round"
                class="bg-surface border border-border-muted focus:border-accent rounded-md px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition-colors"
              />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1">
                <span class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">Submission deadline</span>
                <input
                  type="datetime-local"
                  bind:value={formSub}
                  class="bg-surface border border-border-muted focus:border-accent rounded-md px-2 py-2 text-sm text-fg outline-none transition-colors"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">Voting deadline</span>
                <input
                  type="datetime-local"
                  bind:value={formVote}
                  class="bg-surface border border-border-muted focus:border-accent rounded-md px-2 py-2 text-sm text-fg outline-none transition-colors"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              class="mt-1 inline-flex items-center justify-center rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2.5 hover:bg-accent-bg-strong transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create + set active'}
            </button>
          </form>
        {/if}

        {#if formError}
          <p class="text-warn font-mono text-xs mt-3">⚠ {formError}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
