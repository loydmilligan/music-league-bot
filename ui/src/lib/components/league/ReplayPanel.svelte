<script lang="ts">
  // Voting Replay (C1) — step one round's voting phase ballot by ballot and see
  // three things side by side: what actually happened, what the Music League
  // results page showed at that moment, and what a chosen observer could have
  // deduced from watching it.
  //
  // Everything recomputes client-side from the round payload, so a scenario
  // change (observers, glance severity, a hunch) is instant.
  import { analyse, justEnough } from '$lib/league-research/deduce.js';
  import type {
    GlanceSeverity,
    ReplayPayload,
    ReplayStep,
    Scenario,
  } from '$lib/league-research/replayTypes.js';
  import ReplayFullView from './ReplayFullView.svelte';
  import ReplayPublicView from './ReplayPublicView.svelte';
  import ReplayDeducibleView from './ReplayDeducibleView.svelte';


  interface RoundRow {
    id: number;
    name: string;
    season: number;
    ballots: number;
  }

  let { leagueId, season }: { leagueId: number; season: number | null } = $props();

  const PRESETS: { label: string; count: number; gs: GlanceSeverity }[] = [
    { label: 'Individual', count: 1, gs: 1 },
    { label: 'Partner', count: 2, gs: 1 },
    { label: 'Partner plus', count: 2, gs: 3 },
    { label: 'Partner double plus', count: 3, gs: 4 },
  ];

  let rounds = $state<RoundRow[]>([]);
  let roundsUnavailable = $state(false);
  let roundId = $state<number | null>(null);
  let manualRound = $state('');
  let payload = $state<ReplayPayload | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let observers = $state<string[]>([]);
  let gs = $state<GlanceSeverity>(2);
  let hunches = $state<{ uri: string; player: string }[]>([]);
  let idx = $state(0);

  let roundToken = 0;

  const scenario = $derived<Scenario>({ observers, gs, hunches });
  const analysis = $derived(payload ? analyse(payload, scenario) : null);
  const step = $derived<ReplayStep | null>(analysis?.steps[idx] ?? null);
  const titles = $derived(
    Object.fromEntries((payload?.songs ?? []).map((s) => [s.uri, s.title])),
  );
  const lastIdx = $derived(Math.max(0, (payload?.ballots.length ?? 1) - 1));
  const marks = $derived(
    Object.values(analysis?.observerPositions ?? {}).sort((a, b) => a - b),
  );
  // Outcome pattern over the CLOSED round, computed outside analyse() because no
  // observer can know it while voting. Anchored on the first observer's own song.
  const target = $derived(observers[0] ?? '');
  const nearMisses = $derived(payload && target ? justEnough(payload, target) : []);

  async function loadRounds(league: number, seasonFilter: number | null) {
    const qs = seasonFilter === null ? '' : `?season=${seasonFilter}`;
    try {
      const res = await fetch(`/api/history/league/${league}/rounds${qs}`);
      if (!res.ok) {
        // Not wired up yet (or gone): fall back to typing a round id by hand so
        // the panel is never blocked on another endpoint.
        roundsUnavailable = true;
        rounds = [];
        return;
      }
      roundsUnavailable = false;
      rounds = await res.json();
      const playable = rounds.filter((r) => r.ballots > 0);
      if (!playable.some((r) => r.id === roundId)) roundId = playable.at(-1)?.id ?? null;
    } catch {
      roundsUnavailable = true;
      rounds = [];
    }
  }

  async function loadRound(id: number) {
    const token = ++roundToken;
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/history/round/${id}/replay`);
      if (!res.ok) throw new Error(`Failed to load round ${id} (${res.status})`);
      const p: ReplayPayload = await res.json();
      if (token !== roundToken) return; // a newer round won the race
      payload = p;
      // A new round means a new cast of players: the old scenario is meaningless.
      observers = [];
      hunches = [];
      idx = 0;
    } catch (e) {
      if (token !== roundToken) return;
      error = e instanceof Error ? e.message : 'Failed to load the round';
      payload = null;
    } finally {
      if (token === roundToken) loading = false;
    }
  }

  $effect(() => {
    loadRounds(leagueId, season);
  });

  $effect(() => {
    if (roundId !== null) loadRound(roundId);
  });

  function toggleObserver(voter: string) {
    if (observers.includes(voter)) observers = observers.filter((o) => o !== voter);
    else if (observers.length < 3) observers = [...observers, voter];
  }

  function applyPreset(count: number, severity: GlanceSeverity) {
    const voters = payload?.ballots.map((b) => b.voter) ?? [];
    const kept = observers.filter((o) => voters.includes(o)).slice(0, count);
    const filler = voters.filter((v) => !kept.includes(v)).slice(0, count - kept.length);
    observers = [...kept, ...filler];
    gs = severity;
  }

  function toggleHunch(uri: string, player: string) {
    const at = hunches.findIndex((h) => h.uri === uri && h.player === player);
    hunches = at >= 0 ? hunches.filter((_, i) => i !== at) : [...hunches, { uri, player }];
  }

  const pct = (i: number) => (lastIdx === 0 ? 0 : (i / lastIdx) * 100);
</script>

<div class="rp">
  <!-- Round picker -->
  <div class="rp-bar">
    <span class="rp-lbl">round</span>
    {#if roundsUnavailable}
      <input
        class="rp-input"
        type="number"
        min="1"
        placeholder="round id"
        bind:value={manualRound}
        onchange={() => {
          const n = Number(manualRound);
          if (Number.isInteger(n) && n > 0) roundId = n;
        }}
      />
      <span class="rp-note">round list unavailable — enter a round id</span>
    {:else}
      <select class="rp-select" value={roundId} onchange={(e) => (roundId = Number(e.currentTarget.value))}>
        {#each rounds as r, i (i)}
          <option value={r.id} disabled={r.ballots === 0}>
            S{r.season} · {r.name}{r.ballots === 0 ? ' (no votes)' : ''}
          </option>
        {/each}
      </select>
    {/if}
  </div>

  {#if loading && !payload}
    <p class="rp-note">Loading the round…</p>
  {:else if error}
    <p class="rp-err">{error}</p>
  {:else if !payload}
    <p class="rp-note">Pick a round to replay.</p>
  {:else if !payload.ballots.length}
    <p class="rp-note">No ballots were cast in {payload.round.name} — there is nothing to replay.</p>
  {:else if analysis && step}
    {@const a = analysis}

    <!-- Scenario controls -->
    <div class="rp-bar">
      <span class="rp-lbl">preset</span>
      {#each PRESETS as p, i (i)}
        <button
          type="button"
          class="rp-pill"
          class:is-active={observers.length === p.count && gs === p.gs}
          onclick={() => applyPreset(p.count, p.gs)}>{p.label}</button
        >
      {/each}
      <span class="rp-div"></span>
      <span class="rp-lbl">glance</span>
      {#each [1, 2, 3, 4] as g, i (i)}
        <button
          type="button"
          class="rp-pill"
          class:is-active={gs === g}
          onclick={() => (gs = g as GlanceSeverity)}>{g}GS</button
        >
      {/each}
    </div>

    <div class="rp-bar">
      <span class="rp-lbl">observers</span>
      {#each payload.ballots as b, i (i)}
        <button
          type="button"
          class="rp-pill"
          class:is-active={observers.includes(b.voter)}
          onclick={() => toggleObserver(b.voter)}>{b.voter}</button
        >
      {/each}
    </div>

    <!-- Window readout: N caps everything, so it is said plainly. -->
    <div class="rp-window">
      {#if observers.length < 2}
        <p class="rp-note">Pick a second observer to open a window.</p>
      {:else if a.windowSize === 0}
        <p class="rp-note">
          No window: these two voted back to back, so nothing is learnable at any severity.
        </p>
      {:else}
        <p class="rp-n">{a.windowSize}</p>
        <p class="rp-note">{a.windowSize} ballots between them — this caps everything</p>
      {/if}
    </div>

    <!-- Ballot-indexed scrubber, one notch per ballot -->
    <div class="rp-scrub">
      <div class="rp-track">
        {#if marks.length >= 2}
          <div
            class="rp-shade"
            style={`left:${pct(marks[0])}%;width:${pct(marks.at(-1)!) - pct(marks[0])}%`}
          ></div>
        {/if}
        {#each marks as m, i (i)}
          <div class="rp-mark" style={`left:${pct(m)}%`}></div>
        {/each}
        <input
          class="rp-range"
          type="range"
          min="0"
          max={lastIdx}
          step="1"
          bind:value={idx}
          aria-label="ballot"
        />
      </div>
      <div class="rp-bar">
        <button type="button" class="rp-pill" disabled={idx === 0} onclick={() => (idx -= 1)}>prev</button>
        <button type="button" class="rp-pill" disabled={idx >= lastIdx} onclick={() => (idx += 1)}
          >next</button
        >
        <span class="rp-note">
          ballot {idx + 1} of {payload.ballots.length} — {step.ballot.voter}
        </span>
      </div>
    </div>

    <!-- The three views -->
    <div class="rp-views">
      <section class="rp-view">
        <h4 class="rp-vh">Full</h4>
        <ReplayFullView {step} songs={payload.songs} ballots={payload.ballots} />
      </section>
      <section class="rp-view">
        <h4 class="rp-vh">Public</h4>
        <ReplayPublicView {step} {titles} />
      </section>
      <section class="rp-view">
        <h4 class="rp-vh">Deducible</h4>
        <ReplayDeducibleView
          {step}
          analysis={a}
          {titles}
          {target}
          {nearMisses}
          onHunch={toggleHunch}
        />
      </section>
    </div>
  {/if}
</div>

<style>
  .rp {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rp-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rp-lbl {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-quiet);
  }
  .rp-div {
    width: 1px;
    height: 14px;
    background: var(--line);
  }
  .rp-pill {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .rp-pill:hover:not(:disabled) {
    color: var(--fg);
  }
  .rp-pill:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .rp-pill.is-active {
    color: var(--fg);
    background: var(--mash-pulp-soft);
    border-color: var(--mash-pulp-edge);
  }
  .rp-select,
  .rp-input {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: var(--r-1);
    padding: 3px 8px;
  }
  .rp-window {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .rp-n {
    font-family: var(--font-mono);
    font-size: 26px;
    line-height: 1;
    color: var(--accent);
    margin: 0;
  }
  .rp-scrub {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rp-track {
    position: relative;
    padding: 6px 0;
  }
  .rp-shade {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    border-radius: var(--r-1);
    pointer-events: none;
  }
  .rp-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--sky);
    pointer-events: none;
  }
  .rp-range {
    position: relative;
    width: 100%;
    accent-color: var(--accent);
  }
  .rp-views {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 1100px) {
    .rp-views {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .rp-view {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 10px;
  }
  .rp-vh {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-quiet);
    margin: 0;
  }
  .rp-note {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    font-style: italic;
    margin: 0;
  }
  .rp-err {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--warn, var(--sky));
    margin: 0;
  }
</style>
