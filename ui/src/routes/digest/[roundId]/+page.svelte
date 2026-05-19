<script lang="ts">
  import '$lib/digest/digest.css';
  import DigestSection, { type SectionState } from '$lib/digest/DigestSection.svelte';
  import RegenModal from '$lib/digest/RegenModal.svelte';
  import {
    DIGEST_ROUND,
    DIGEST_SUBMISSIONS,
    DIGEST_VILLAIN,
    DIGEST_FLOW_NOTABLE,
    DIGEST_CONSENSUS,
    DIGEST_COMMENTS,
    DIGEST_CHAT,
    DIGEST_SECTION_ORDER,
    type SectionKind,
  } from '$lib/digest/fixtures.js';
  import type { PageData } from './$types.js';

  let { data }: { data: PageData } = $props();

  type PipelineStage = 'prepare' | 'draft' | 'refine' | 'finalize';
  const PIPELINE: { id: PipelineStage; label: string }[] = [
    { id: 'prepare',  label: 'Prepare data' },
    { id: 'draft',    label: 'Generate draft' },
    { id: 'refine',   label: 'Refine sections' },
    { id: 'finalize', label: 'Finalize & export' },
  ];
  const activeIdx = 0;

  function stepState(i: number): 'done' | 'active' | 'pending' {
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'pending';
  }

  const SECTION_LABELS: Record<SectionKind, string> = {
    podium: 'A-side · final ranking',
    villain: 'B-side · the downvote',
    flow: 'Credits · notable votes',
    consensus: 'Consensus & controversy',
    quotes: 'Liner quotes',
    chat: 'Back cover · chat notes',
  };

  // Section preview snippets — used for the regen-modal "current copy" panel.
  // Replaced by real `content_json` once T7 lands.
  const SECTION_PREVIEWS: Record<SectionKind, string> = {
    podium: `Six tracks, ranked. ${DIGEST_SUBMISSIONS[0].title} (${DIGEST_SUBMISSIONS[0].artist}) wins outright at ${DIGEST_SUBMISSIONS[0].points} pts.`,
    villain: `${DIGEST_VILLAIN.songTitle} drew the round's lone downvote — ${DIGEST_VILLAIN.points} pts from ${DIGEST_VILLAIN.downvoter} (theme chooser). "${DIGEST_VILLAIN.comment}"`,
    flow: 'Four notable edges: first cross-faction vote, crossed enemy lines, mutual top-billing, theme-chooser downvote.',
    consensus: `Most agreed: ${DIGEST_CONSENSUS.agreed.title}. Most contested: ${DIGEST_CONSENSUS.contested.title}.`,
    quotes: DIGEST_COMMENTS.map((c) => `"${c.quote}" — ${c.who}`).join(' · '),
    chat: DIGEST_CHAT.map((c) => `[${c.headline}] ${c.text ?? c.quote ?? ''}`).join(' · '),
  };

  // Per-section state. Wave 2 keeps this local; T7 will persist to digest_sections.
  let sectionStates = $state<Record<SectionKind, SectionState>>({
    podium: 'default',
    villain: 'default',
    flow: 'default',
    consensus: 'default',
    quotes: 'default',
    chat: 'default',
  });

  // Last instructions per section, for prefilling the modal next time.
  let lastInstructions = $state<Record<SectionKind, string>>({
    podium: '',
    villain: '',
    flow: '',
    consensus: '',
    quotes: '',
    chat: '',
  });
  let lastChips = $state<Record<SectionKind, string[]>>({
    podium: [],
    villain: [],
    flow: [],
    consensus: [],
    quotes: [],
    chat: [],
  });

  // Modal state. `target` is the section kind, or 'whole' for whole-draft regen.
  let modalTarget = $state<SectionKind | 'whole' | null>(null);
  let errorToast = $state<string | null>(null);

  function openRegen(kind: SectionKind) {
    modalTarget = kind;
  }
  function openWholeRegen() {
    modalTarget = 'whole';
  }
  function closeModal() {
    modalTarget = null;
  }

  function toggleExcluded(kind: SectionKind) {
    sectionStates[kind] = sectionStates[kind] === 'excluded' ? 'default' : 'excluded';
  }
  function toggleLocked(kind: SectionKind) {
    sectionStates[kind] = sectionStates[kind] === 'locked' ? 'default' : 'locked';
  }
  function kebabAction(_kind: SectionKind, action: 'edit' | 'up' | 'down' | 'delete') {
    // Wired stub. Wave 3 implements edit-inline, reordering, delete persistence.
    console.warn('[digest] kebab action not yet wired:', action);
  }

  async function submitRegen(payload: { chips: string[]; instructions: string }) {
    const target = modalTarget;
    modalTarget = null;
    if (!target) return;

    const kinds: SectionKind[] = target === 'whole'
      ? DIGEST_SECTION_ORDER.filter((k) => sectionStates[k] !== 'locked' && sectionStates[k] !== 'excluded')
      : [target];

    for (const k of kinds) {
      lastChips[k] = payload.chips;
      lastInstructions[k] = payload.instructions;
      sectionStates[k] = 'regenerating';
    }

    try {
      if (target === 'whole') {
        await callApi(`/api/digest/${data.roundId}/regenerate`, payload);
      } else {
        await callApi(`/api/digest/${data.roundId}/sections/${target}/regenerate`, payload);
      }
    } catch (err) {
      errorToast = err instanceof Error ? err.message : 'Regenerate failed';
      setTimeout(() => (errorToast = null), 4000);
    } finally {
      for (const k of kinds) {
        // Wave 2 stub: no draft persisted yet, so flip back to default
        // (or stay locked if user locked it during regen).
        if (sectionStates[k] === 'regenerating') sectionStates[k] = 'default';
      }
    }
  }

  async function callApi(url: string, payload: { chips: string[]; instructions: string }) {
    // Backend scaffold (T2) returns 404 for missing draft/section rows. Wave 2 LLM
    // service (T7) writes them. Treat 404 here as "scaffold mode — no draft yet"
    // and don't surface as a user-facing error.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Regenerate failed (${res.status})`);
    }
  }

  const excludedCount = $derived(
    DIGEST_SECTION_ORDER.filter((k) => sectionStates[k] === 'excluded').length,
  );
  const lockedCount = $derived(
    DIGEST_SECTION_ORDER.filter((k) => sectionStates[k] === 'locked').length,
  );

  const modalLabel = $derived(
    modalTarget === 'whole'
      ? 'whole draft · all unlocked sections'
      : modalTarget
        ? SECTION_LABELS[modalTarget]
        : '',
  );
  const modalPreview = $derived(
    modalTarget === 'whole'
      ? 'All non-locked, non-excluded sections will regenerate in parallel.'
      : modalTarget
        ? SECTION_PREVIEWS[modalTarget]
        : '',
  );
  const modalInitialChips = $derived(
    modalTarget && modalTarget !== 'whole' ? lastChips[modalTarget] : [],
  );
  const modalInitialInstructions = $derived(
    modalTarget && modalTarget !== 'whole' ? lastInstructions[modalTarget] : '',
  );
</script>

<svelte:head>
  <title>Digest preview · {data.roundId}</title>
</svelte:head>

<div class="dg-page-head">
  <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0 0 4px;">
    music-league-bot · /digest · {data.roundId}
  </p>
  <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
    Round digest preview
  </h1>
  <p class="dg-page-sub">
    Generated when voting closed. LLM analysis cached. Export captures the framed area below as one tall PNG, ready to drop into the league chat.
  </p>
</div>

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

<div class="dg-page-actions">
  <button type="button" class="mash-btn mash-btn--secondary" onclick={openWholeRegen}>
    ↻ Regenerate whole draft
  </button>
  <span class="dg-page-actions-spacer"></span>
  <span style="font: 500 11px/1 var(--font-mono); color: var(--fg-quiet);">
    draft cached · {excludedCount} excluded · {lockedCount} locked
  </span>
</div>

{#if errorToast}
  <div role="alert" style="margin: 12px 0; padding: 10px 14px; background: var(--ember-soft); border: 1px solid var(--ember); color: var(--ember); border-radius: var(--r-2); font: 600 12px/1.4 var(--font-mono);">
    {errorToast}
  </div>
{/if}

<div class="dg-export dgC-bg">
  <header class="dgC-mast">
    <div class="dgC-mast-row1">
      <span>m/l</span>
      <span class="sep">/</span>
      <span>{DIGEST_ROUND.league.toLowerCase()}</span>
      <span class="sep">/</span>
      <span>S{DIGEST_ROUND.season}</span>
      <span class="sep">/</span>
      <span>R-{DIGEST_ROUND.number}</span>
      <span class="sep">/</span>
      <span class="pulp">closed {DIGEST_ROUND.voteClosed}</span>
    </div>
    <h1 class="dgC-mast-title">"{DIGEST_ROUND.name}"</h1>
    <p class="dgC-mast-deck">
      a round of <b>{DIGEST_ROUND.submissions}</b> songs by <b>{DIGEST_ROUND.voters}</b> voters · theme chosen by <b>{DIGEST_ROUND.themeChooser}</b> · <b>{DIGEST_ROUND.totalPointsAwarded}</b> points awarded
    </p>
  </header>

  {#each DIGEST_SECTION_ORDER as kind (kind)}
    <DigestSection
      {kind}
      label={SECTION_LABELS[kind]}
      sectionState={sectionStates[kind]}
      submissions={DIGEST_SUBMISSIONS}
      villain={DIGEST_VILLAIN}
      flowNotable={DIGEST_FLOW_NOTABLE}
      consensus={DIGEST_CONSENSUS}
      comments={DIGEST_COMMENTS}
      chat={DIGEST_CHAT}
      onToggleExcluded={() => toggleExcluded(kind)}
      onToggleLocked={() => toggleLocked(kind)}
      onRegen={() => openRegen(kind)}
      onKebabAction={(action) => kebabAction(kind, action)}
    />
  {/each}

  <footer class="dgC-foot">
    <div>m/l · liner notes · <span class="pulp">"{DIGEST_ROUND.name}"</span></div>
    <div>{DIGEST_ROUND.league.toLowerCase()} · s{DIGEST_ROUND.season} · r-{DIGEST_ROUND.number} · pressed {DIGEST_ROUND.voteClosed}</div>
  </footer>
</div>

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
