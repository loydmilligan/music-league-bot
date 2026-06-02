<script lang="ts">
  import '$lib/digest/digest.css';
  import { invalidateAll } from '$app/navigation';
  import DigestSection, { type SectionState } from '$lib/digest/DigestSection.svelte';
  import RegenModal from '$lib/digest/RegenModal.svelte';
  import RelContextDiffModal, { type DiffSegment } from '$lib/digest/RelContextDiffModal.svelte';
  import { SECTION_KINDS, type SectionKind } from '$lib/digest/llm.js';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types.js';
  import type { RoundIndexEntry } from './+page.server.js';

  let { data }: { data: PageData } = $props();

  // Export shape. The PNG renderer loads this page with ?format=mobile|wide; when
  // mobile, the .dg-export frame gets the dg-export--mobile reflow class. The
  // on-screen toggle (`exportShape`) drives which format the Finalize action
  // requests — defaulting to mobile, since WhatsApp is the primary share target.
  const isMobileExport = $derived(page.url.searchParams.get('format') === 'mobile');
  let exportShape = $state<'mobile' | 'wide'>('mobile');

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

  // When stage === 'finalize' (finalized_at is set), activeIdx advances past
  // the last step so all 4 pipeline pills render as 'done'.
  const activeIdx = $derived(
    data.stage === 'prepare'
      ? 0
      : data.stage === 'refine'
        ? 2
        : data.stage === 'finalize'
          ? 4
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

  // -------- Import from CLI (sprint-11 Task B) ----------
  // Backend ships POST /api/digest/:roundId/import-export-zip that triggers
  // the host-side music-league CLI, downloads export.zip, runs it through the
  // existing import pipeline, then returns the refreshed prep checks payload.
  // Backend response shape (per sprint-11.md):
  //   success: { ok: true, imported: { submissions, votes, voteComments },
  //              checks: <prepare-checks payload> }
  //   failure: { ok: false, reason: string, stage: 'auth'|'cli'|'download'|'import'|'other' }
  // Visibility: button shows when any of the export.zip-resolvable checks
  // (Submissions / Votes / Vote comments) is failing.
  let importing = $state(false);
  const exportZipCheckNames = ['Submissions', 'Votes', 'Vote comments'];
  const exportZipChecksFailing = $derived(
    data.stage === 'prepare'
      ? data.checks.some((c) => exportZipCheckNames.includes(c.name) && !c.ok)
      : false,
  );

  async function importFromCli() {
    if (importing) return;
    importing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/import-export-zip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`import failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        stage?: 'auth' | 'cli' | 'download' | 'import' | 'other';
        imported?: { submissions?: number; votes?: number; voteComments?: number };
      };
      if (body.ok === false) {
        if (body.stage === 'auth') {
          showError('Music League auth has expired — click the ml-auth badge to re-login, then retry.');
        } else {
          showError(`Import failed (${body.stage ?? 'unknown'}): ${body.reason ?? 'no detail'}`);
        }
        await invalidateAll();
        return;
      }
      const imp = body.imported ?? {};
      const parts = [
        imp.submissions != null ? `${imp.submissions} submissions` : null,
        imp.votes != null ? `${imp.votes} votes` : null,
        imp.voteComments != null ? `${imp.voteComments} comments` : null,
      ].filter(Boolean);
      showError(parts.length ? `Imported: ${parts.join(', ')}` : 'Import complete.');
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      importing = false;
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

  // -------- Rel-context diff (T13 deferred portion) ----------
  // Two sources, in priority order:
  //   1. data.relContext from +page.server.ts (GET /api/leagues/:leagueId/rel-context),
  //      which gives us refresh-persisted previousContext / context.
  //   2. relContextFromFinalize: $state populated by the latest finalize POST
  //      response when /api/digest/:roundId/finalize returns a fresh
  //      { previous, proposed, updatedAt, leagueId } payload. This takes
  //      precedence so the just-finalized diff surfaces immediately without
  //      waiting for invalidateAll() to roundtrip.
  type FinalizeRelContext = {
    leagueId: number;
    previous: string;
    proposed: string;
    updatedAt?: string | null;
  };
  let relContextFromFinalize = $state<FinalizeRelContext | null>(null);

  const relDiff = $derived.by<{ leagueId: number; previous: string; proposed: string } | null>(() => {
    if (relContextFromFinalize) {
      return {
        leagueId: relContextFromFinalize.leagueId,
        previous: relContextFromFinalize.previous,
        proposed: relContextFromFinalize.proposed,
      };
    }
    const rc = data.relContext;
    if (rc && rc.previousContext != null && rc.context !== rc.previousContext) {
      return { leagueId: rc.leagueId, previous: rc.previousContext, proposed: rc.context };
    }
    return null;
  });

  let relDiffOpen = $state(false);
  function openRelDiff() {
    if (relDiff) relDiffOpen = true;
  }
  function closeRelDiff() {
    relDiffOpen = false;
  }

  // -------- Finalize stage ----------
  // POST /api/digest/:roundId/finalize. Backend T11 was instructed to document
  // the response shape (download URL vs PNG bytes). Until that lands the
  // endpoint returns { stub: true, downloadUrl: null }; this handler accepts:
  //   - response.body is image/* → blob download
  //   - response is JSON with `downloadUrl` (or `url`) string → anchor download
  //   - neither → invalidateAll() still runs so finalized_at-driven pipeline
  //     state advances; user sees a non-fatal note that PNG wasn't returned.
  let finalizing = $state(false);
  async function finalizeAndDownload() {
    finalizing = true;
    try {
      const res = await fetch(`/api/digest/${data.roundId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: exportShape }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`finalize failed (${res.status}) ${text.slice(0, 200)}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
      const filename = `r-${data.roundId}-digest-${exportShape}-${ts}.png`;

      if (ct.startsWith('image/')) {
        const blob = await res.blob();
        triggerDownload(URL.createObjectURL(blob), filename, true);
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          downloadUrl?: string | null;
          url?: string | null;
          filename?: string | null;
          stub?: boolean;
          relContext?: FinalizeRelContext | null;
          warnings?: string[];
        };
        if (body.relContext && typeof body.relContext.previous === 'string' && typeof body.relContext.proposed === 'string') {
          relContextFromFinalize = body.relContext;
        }
        if (body.warnings?.length) {
          showError(`finalize warnings: ${body.warnings.join(' · ')}`);
        }
        const url = body.downloadUrl ?? body.url ?? null;
        if (url) {
          triggerDownload(url, body.filename ?? filename, false);
        } else if (body.stub) {
          showError('Finalize endpoint is still stubbed — PNG not yet generated. Pipeline state will not advance until backend T11 ships.');
        } else {
          showError('Finalize returned no downloadable PNG.');
        }
      }
      await invalidateAll();
    } catch (err) {
      showError(err);
    } finally {
      finalizing = false;
    }
  }

  function triggerDownload(href: string, filename: string, isObjectUrl: boolean) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (isObjectUrl) {
      // Revoke after the click; small delay so the download starts.
      setTimeout(() => URL.revokeObjectURL(href), 5000);
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
      <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={rerunPrepare} disabled={preparing || importing}>
        {preparing ? '…' : '↻'} Re-run checks
      </button>
      {#if exportZipChecksFailing}
        <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={importFromCli} disabled={importing || preparing}>
          {importing ? '… running CLI' : '↓'} Import from CLI
        </button>
      {/if}
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
    <button type="button" class="mash-btn mash-btn--secondary" onclick={openWholeRegen} disabled={finalizing}>
      ↻ Regenerate whole draft
    </button>
    {#if data.stage === 'refine'}
      <div class="dg-fmt-toggle" role="group" aria-label="Export format">
        <button
          type="button"
          class:is-on={exportShape === 'mobile'}
          onclick={() => (exportShape = 'mobile')}
          disabled={finalizing}
          title="Phone-portrait card, tuned for WhatsApp"
        >📱 Mobile</button>
        <button
          type="button"
          class:is-on={exportShape === 'wide'}
          onclick={() => (exportShape = 'wide')}
          disabled={finalizing}
          title="Wide desktop broadsheet (800px)"
        >🖥 Wide</button>
      </div>
      <button type="button" class="mash-btn mash-btn--primary" onclick={finalizeAndDownload} disabled={finalizing}>
        {finalizing ? '…' : '↓'} Finalize &amp; download {exportShape} png
      </button>
    {:else if data.stage === 'finalize'}
      <span style="font: 600 11px/1 var(--font-mono); color: var(--moss);">
        ✓ finalized {data.draft.finalized_at}
      </span>
    {/if}
    <span class="dg-page-actions-spacer"></span>
    <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">
      draft cached · {excludedCount} excluded · {lockedCount} locked
    </span>
  </div>

  <div class="dg-export dgC-bg" class:dg-export--mobile={isMobileExport}>
    <header class="dgC-mast">
      <div class="dgC-mast-row1" data-export-hide="1">
        <span>m/l</span>
        <span class="sep">/</span>
        <span>r-{data.roundId}</span>
        <span class="sep">/</span>
        <span class="pulp">generated {data.draft.generated_at}</span>
      </div>
      <h1 class="dgC-mast-title">Round digest</h1>
      <p class="dgC-mast-deck" data-export-hide="1">
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

  {#if relDiff}
    <div class="dg-relctx-footer">
      <span class="dg-relctx-tag">rel context updated</span>
      <button type="button" class="dg-relctx-link" onclick={openRelDiff}>view diff →</button>
    </div>
  {/if}
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

{#if relDiffOpen && relDiff}
  <RelContextDiffModal
    previous={relDiff.previous}
    proposed={relDiff.proposed}
    leagueId={relDiff.leagueId}
    onClose={closeRelDiff}
    onSaved={async (newContext) => {
      relContextFromFinalize = null;
      relDiffOpen = false;
      await invalidateAll();
      showError(`rel context saved (${newContext.length} chars)`);
    }}
    onPatchError={(msg) => showError(msg)}
  />
{/if}

<style>
  .dg-fmt-toggle {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .dg-fmt-toggle button {
    background: var(--surface);
    border: 0;
    padding: 7px 11px;
    font: 600 11px/1 var(--font-mono);
    color: var(--fg-muted);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .dg-fmt-toggle button + button {
    border-left: 1px solid var(--line);
  }
  .dg-fmt-toggle button:hover:not(:disabled) {
    color: var(--fg);
  }
  .dg-fmt-toggle button.is-on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
  }
  .dg-fmt-toggle button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .dg-relctx-footer {
    margin-top: 16px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    display: flex;
    align-items: center;
    gap: 10px;
    font: 600 11px/1 var(--font-mono);
  }
  .dg-relctx-tag {
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--moss, #7ea864);
  }
  .dg-relctx-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--mash-pulp, var(--fg));
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    font: inherit;
  }
  .dg-relctx-link:hover { color: var(--fg); }
</style>
