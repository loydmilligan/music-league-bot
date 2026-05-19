<script lang="ts">
  import '$lib/digest/digest.css';
  import { invalidateAll } from '$app/navigation';
  import DigestSection, { type SectionState } from '$lib/digest/DigestSection.svelte';
  import RegenModal from '$lib/digest/RegenModal.svelte';
  import { SECTION_KINDS, type SectionKind } from '$lib/digest/llm.js';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types.js';
  import type { RoundIndexEntry } from './+page.server.js';

  let { data }: { data: PageData } = $props();

  type LeagueGroup = {
    leagueId: number;
    leagueName: string;
    seasons: { seasonId: number; seasonNumber: number; rounds: RoundIndexEntry[] }[];
  };

  const roundGroups = $derived.by<LeagueGroup[]>(() => {
    const byLeague = new Map<number, LeagueGroup>();
    for (const r of data.roundsIndex) {
      let lg = byLeague.get(r.league_id);
      if (!lg) {
        lg = { leagueId: r.league_id, leagueName: r.league_name, seasons: [] };
        byLeague.set(r.league_id, lg);
      }
      let sg = lg.seasons.find((s) => s.seasonId === r.season_id);
      if (!sg) {
        sg = { seasonId: r.season_id, seasonNumber: r.season_number, rounds: [] };
        lg.seasons.push(sg);
      }
      sg.rounds.push(r);
    }
    return [...byLeague.values()];
  });

  const votingStillOpen = $derived.by(() => {
    const cr = data.currentRound;
    if (cr.voting_deadline) {
      const t = Date.parse(cr.voting_deadline);
      if (Number.isFinite(t) && t > Date.now()) return true;
    } else if (cr.season_status === 'active') {
      return true;
    }
    return false;
  });

  function onRoundChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const next = Number(target.value);
    if (Number.isFinite(next) && next !== data.roundId) {
      goto(`/digest/${next}`);
    }
  }

  function roundOptionLabel(r: RoundIndexEntry): string {
    const name = r.name && r.name.trim() ? r.name : `Round ${r.id}`;
    return `r-${r.id} · ${name}`;
  }

  type PipelineStage = 'prepare' | 'draft' | 'refine' | 'finalize';
  const PIPELINE: { id: PipelineStage; label: string }[] = [
    { id: 'prepare',  label: 'Prepare data' },
    { id: 'draft',    label: 'Generate draft' },
    { id: 'refine',   label: 'Refine sections' },
    { id: 'finalize', label: 'Finalize & export' },
  ];

  const SECTION_LABELS: Record<SectionKind, string> = {
    podium: 'A-side · final ranking',
    villain: 'B-side · the downvote',
    flow: 'Credits · notable votes',
    consensus: 'Consensus & controversy',
    quotes: 'Liner quotes',
    chat: 'Back cover · chat notes',
  };

  const activeIdx = $derived(
    data.stage === 'prepare'
      ? 0
      : data.stage === 'refine'
        ? 2
        : data.stage === 'finalize'
          ? 3
          : 0,
  );
  function stepState(i: number): 'done' | 'active' | 'pending' {
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'pending';
  }

  // -------- Prepare stage ----------
  let preparing = $state(false);
  async function rerunPrepare() {
    preparing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/prepare`, { method: 'POST' });
      if (!res.ok) throw new Error(`prepare failed (${res.status})`);
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      preparing = false;
    }
  }

  let drafting = $state(false);
  async function generateDraft() {
    drafting = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`draft failed (${res.status}) ${text.slice(0, 200)}`);
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      drafting = false;
    }
  }

  // -------- Refine stage state ----------
  // Each section's UI state. Initialized from DB row state when sections load,
  // and reset on data refresh. Excluded/locked transitions stay local until a
  // backend PATCH endpoint exists for section.state.
  let sectionStates = $state<Record<string, SectionState>>({});
  $effect(() => {
    if (data.stage === 'refine' || data.stage === 'finalize') {
      const next: Record<string, SectionState> = {};
      for (const s of data.sections) next[s.id] = (s.state as SectionState) ?? 'default';
      sectionStates = next;
    } else {
      sectionStates = {};
    }
  });

  let lastInstructions = $state<Record<string, string>>({});
  let lastChips = $state<Record<string, string[]>>({});

  // modalTarget: 'whole' or a specific section id
  let modalTarget = $state<string | 'whole' | null>(null);

  function openRegen(sectionId: string) { modalTarget = sectionId; }
  function openWholeRegen() { modalTarget = 'whole'; }
  function closeModal() { modalTarget = null; }

  function toggleExcluded(id: string) {
    sectionStates[id] = sectionStates[id] === 'excluded' ? 'default' : 'excluded';
  }
  function toggleLocked(id: string) {
    sectionStates[id] = sectionStates[id] === 'locked' ? 'default' : 'locked';
  }
  function kebabAction(_id: string, action: 'edit' | 'up' | 'down' | 'delete') {
    console.warn('[digest] kebab action not yet wired:', action);
  }

  async function submitRegen(payload: { chips: string[]; instructions: string }) {
    const target = modalTarget;
    modalTarget = null;
    if (!target || (data.stage !== 'refine' && data.stage !== 'finalize')) return;

    const ids: string[] = target === 'whole'
      ? data.sections
          .filter((s) => sectionStates[s.id] !== 'locked' && sectionStates[s.id] !== 'excluded')
          .map((s) => s.id)
      : [target];

    for (const id of ids) {
      lastChips[id] = payload.chips;
      lastInstructions[id] = payload.instructions;
      sectionStates[id] = 'regenerating';
    }

    try {
      const url = target === 'whole'
        ? `/api/digest/${data.roundId}/regenerate`
        : `/api/digest/${data.roundId}/sections/${target}/regenerate`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`regen failed (${res.status}) ${text.slice(0, 200)}`);
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
      for (const id of ids) {
        if (sectionStates[id] === 'regenerating') sectionStates[id] = 'default';
      }
    }
  }

  // -------- Shared ----------
  let errorToast = $state<string | null>(null);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  function showError(err: unknown) {
    errorToast = err instanceof Error ? err.message : String(err);
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (errorToast = null), 5000);
  }

  // -------- Refine derived ----------
  const sectionsList = $derived(
    data.stage === 'refine' || data.stage === 'finalize' ? data.sections : [],
  );
  const excludedCount = $derived(
    sectionsList.filter((s) => sectionStates[s.id] === 'excluded').length,
  );
  const lockedCount = $derived(
    sectionsList.filter((s) => sectionStates[s.id] === 'locked').length,
  );

  const allChecksOk = $derived(
    data.stage === 'prepare' ? data.checks.every((c) => c.optional || c.ok) : false,
  );

  const modalLabel = $derived(
    modalTarget === 'whole'
      ? 'whole draft · all unlocked sections'
      : modalTarget
        ? labelForSection(modalTarget)
        : '',
  );
  const modalPreview = $derived(
    modalTarget === 'whole'
      ? 'All non-locked, non-excluded sections will regenerate in parallel.'
      : modalTarget
        ? previewForSection(modalTarget)
        : '',
  );
  const modalInitialChips = $derived(
    modalTarget && modalTarget !== 'whole' ? lastChips[modalTarget] ?? [] : [],
  );
  const modalInitialInstructions = $derived(
    modalTarget && modalTarget !== 'whole' ? lastInstructions[modalTarget] ?? '' : '',
  );

  function labelForSection(id: string): string {
    const s = sectionsList.find((x) => x.id === id);
    return s ? SECTION_LABELS[s.kind as SectionKind] : '';
  }
  function previewForSection(id: string): string {
    const s = sectionsList.find((x) => x.id === id);
    if (!s) return '';
    const c = s.content as { title?: string; body?: string; items?: unknown[] };
    if (c?.body) return c.body;
    if (Array.isArray(c?.items) && c.items.length) {
      return c.items.slice(0, 3).map((it) => typeof it === 'string' ? it : JSON.stringify(it)).join(' · ');
    }
    return '(empty)';
  }

  // Section order for rendering — preserve DB position order.
  const renderSections = $derived(
    [...sectionsList].sort((a, b) => a.position - b.position),
  );

  // Make sure unknown section kinds don't crash.
  function kindOrFallback(k: string): SectionKind {
    return (SECTION_KINDS as readonly string[]).includes(k) ? (k as SectionKind) : 'flow';
  }
</script>

<svelte:head>
  <title>Digest preview · r-{data.roundId}</title>
</svelte:head>

<div class="dg-page-head">
  <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0 0 4px;">
    music-league-bot · /digest · r-{data.roundId}
  </p>
  <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
    Round digest preview
  </h1>
  <p class="dg-page-sub">
    Generated when voting closed. LLM analysis cached. Export captures the framed area below as one tall PNG, ready to drop into the league chat.
  </p>

  <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
    <label for="dg-round-select" style="font: 600 11px/1 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-muted);">
      Round
    </label>
    <select
      id="dg-round-select"
      onchange={onRoundChange}
      value={String(data.roundId)}
      style="font: 500 13px/1.2 var(--font-body); padding: 6px 10px; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: var(--r-2); min-width: 280px;"
    >
      {#each roundGroups as lg (lg.leagueId)}
        {#each lg.seasons as sg (sg.seasonId)}
          <optgroup label="{lg.leagueName} · season {sg.seasonNumber}">
            {#each sg.rounds as r (r.id)}
              <option value={String(r.id)}>{roundOptionLabel(r)}</option>
            {/each}
          </optgroup>
        {/each}
      {/each}
    </select>
  </div>
</div>

{#if votingStillOpen}
  <div role="status" style="margin: 12px 0; padding: 10px 14px; background: var(--amber-soft, rgba(255, 184, 0, 0.12)); border: 1px solid var(--amber, #d29400); color: var(--amber, #d29400); border-radius: var(--r-2); font: 600 12px/1.4 var(--font-mono);">
    ! voting still open for r-{data.currentRound.id}{data.currentRound.voting_deadline ? ` · deadline ${data.currentRound.voting_deadline}` : ' · no deadline set'} — digest may change.
  </div>
{/if}

<div class="dg-pipeline" style="margin: 16px 0;">
  {#each PIPELINE as step, i (step.id)}
    {@const s = stepState(i)}
    <button type="button" class="dg-pipe-step is-{s}" disabled={s !== 'active'}>
      <span class="dg-pipe-num">{s === 'done' ? '✓' : i + 1}</span>
      <span>{step.label}</span>
    </button>
    {#if i < PIPELINE.length - 1}
      <span class="dg-pipe-arrow" aria-hidden="true">→</span>
    {/if}
  {/each}
</div>

{#if errorToast}
  <div role="alert" style="margin: 12px 0; padding: 10px 14px; background: var(--ember-soft); border: 1px solid var(--ember); color: var(--ember); border-radius: var(--r-2); font: 600 12px/1.4 var(--font-mono);">
    {errorToast}
  </div>
{/if}

{#if data.stage === 'prepare'}
  <section class="dg-prepare" style="background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-3); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
    <header style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;">
      <h2 style="margin: 0; font: 700 16px/1.2 var(--font-body); color: var(--fg);">
        Prepare data · r-{data.roundId}
      </h2>
      <span style="font: 600 11px/1 var(--font-mono); color: {allChecksOk ? 'var(--moss)' : 'var(--amber)'};">
        {allChecksOk ? '✓ all checks passed · ready to draft' : '! checks pending'}
      </span>
    </header>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      {#each data.checks as check (check.name)}
        <div style="display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: baseline; padding: 8px 10px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);">
          <span style="text-align: center; font: 700 14px/1 var(--font-mono); color: {check.ok ? 'var(--moss)' : check.optional ? 'var(--fg-quiet)' : 'var(--amber)'};">
            {check.ok ? '✓' : check.optional ? '–' : '!'}
          </span>
          <span style="font: 500 13px/1.4 var(--font-body); color: {check.optional && !check.ok ? 'var(--fg-quiet)' : 'var(--fg)'};">
            {check.name}{check.count !== undefined ? ` · ${check.count}` : ''}{check.optional && !check.ok ? ' (optional)' : ''}
          </span>
          <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">{check.src}</span>
        </div>
      {/each}
    </div>

    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={rerunPrepare} disabled={preparing}>
        {preparing ? '…' : '↻'} Re-run checks
      </button>
      <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" disabled style="opacity: 0.5;">
        ↑ Upload export.zip manually
      </button>
      <span style="flex: 1;"></span>
      {#if allChecksOk}
        <button type="button" class="mash-btn mash-btn--primary" onclick={generateDraft} disabled={drafting}>
          {drafting ? '…' : '✎'} Generate draft
        </button>
      {/if}
    </div>
  </section>
{:else if data.stage === 'refine' || data.stage === 'finalize'}
  <div class="dg-page-actions">
    <button type="button" class="mash-btn mash-btn--secondary" onclick={openWholeRegen}>
      ↻ Regenerate whole draft
    </button>
    <span class="dg-page-actions-spacer"></span>
    <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">
      draft cached · {excludedCount} excluded · {lockedCount} locked
    </span>
  </div>

  <div class="dg-export dgC-bg">
    <header class="dgC-mast">
      <div class="dgC-mast-row1">
        <span>m/l</span>
        <span class="sep">/</span>
        <span>r-{data.roundId}</span>
        <span class="sep">/</span>
        <span class="pulp">generated {data.draft.generated_at}</span>
      </div>
      <h1 class="dgC-mast-title">Round digest</h1>
      <p class="dgC-mast-deck">
        {data.sections.length} sections · whole-regen count {data.draft.whole_regen_count}
      </p>
    </header>

    {#each renderSections as section (section.id)}
      <DigestSection
        kind={kindOrFallback(section.kind)}
        label={SECTION_LABELS[kindOrFallback(section.kind)]}
        sectionState={sectionStates[section.id] ?? 'default'}
        content={section.content}
        onToggleExcluded={() => toggleExcluded(section.id)}
        onToggleLocked={() => toggleLocked(section.id)}
        onRegen={() => openRegen(section.id)}
        onKebabAction={(action) => kebabAction(section.id, action)}
      />
    {/each}

    <footer class="dgC-foot">
      <div>m/l · liner notes · r-{data.roundId}</div>
      <div>generated {data.draft.generated_at}{data.draft.finalized_at ? ` · finalized ${data.draft.finalized_at}` : ''}</div>
    </footer>
  </div>
{/if}

{#if modalTarget !== null}
  <RegenModal
    sectionLabel={modalLabel}
    sectionPreview={modalPreview}
    initialChips={modalInitialChips}
    initialInstructions={modalInitialInstructions}
    onCancel={closeModal}
    onSubmit={submitRegen}
  />
{/if}
