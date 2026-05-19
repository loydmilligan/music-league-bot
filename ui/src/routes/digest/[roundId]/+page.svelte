<script lang="ts">
  import '$lib/digest/digest.css';
  import DigestSection from '$lib/digest/DigestSection.svelte';
  import {
    DIGEST_ROUND,
    DIGEST_SUBMISSIONS,
    DIGEST_VILLAIN,
    DIGEST_FLOW_NOTABLE,
    DIGEST_CONSENSUS,
    DIGEST_COMMENTS,
    DIGEST_CHAT,
    DIGEST_SECTION_ORDER,
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
  // Wave-1 scaffold: step 1 active, 2-4 pending. DB wiring lands in Wave 2.
  const activeIdx = 0;

  function stepState(i: number): 'done' | 'active' | 'pending' {
    if (i < activeIdx) return 'done';
    if (i === activeIdx) return 'active';
    return 'pending';
  }
</script>

<svelte:head>
  <title>Digest preview · {data.roundId}</title>
</svelte:head>

<div class="dg-page-head">
  <p class="t-eyebrow" style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0 0 4px;">
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
    {@const state = stepState(i)}
    <button type="button" class="dg-pipe-step is-{state}" disabled={state !== 'active'}>
      <span class="dg-pipe-num">{state === 'done' ? '✓' : i + 1}</span>
      <span>{step.label}</span>
    </button>
    {#if i < PIPELINE.length - 1}
      <span class="dg-pipe-arrow" aria-hidden="true">→</span>
    {/if}
  {/each}
</div>

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
      submissions={DIGEST_SUBMISSIONS}
      villain={DIGEST_VILLAIN}
      flowNotable={DIGEST_FLOW_NOTABLE}
      consensus={DIGEST_CONSENSUS}
      comments={DIGEST_COMMENTS}
      chat={DIGEST_CHAT}
    />
  {/each}

  <footer class="dgC-foot">
    <div>m/l · liner notes · <span class="pulp">"{DIGEST_ROUND.name}"</span></div>
    <div>{DIGEST_ROUND.league.toLowerCase()} · s{DIGEST_ROUND.season} · r-{DIGEST_ROUND.number} · pressed {DIGEST_ROUND.voteClosed}</div>
  </footer>
</div>
