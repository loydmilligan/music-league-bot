<script lang="ts">
	// The ledger drawer: the round as a scoreboard at one moment, with each song's
	// total broken into who put the points there.
	//
	// Reading the bar: grey is everyone not being watched, a colour is a selected
	// observer who has ALREADY voted, red is the ballot you are looking at now. The
	// current voter is red even when they are one of the selected people — they only
	// take their colour once they fall behind the scrubber. That is what makes "who
	// moved this song, just now" readable at a glance.
	import type { LedgerRow } from '$lib/league-research/ledger.js';

	let {
		rows,
		currentVoter,
		stepLabel,
		observerColour,
	}: {
		rows: LedgerRow[];
		currentVoter: string;
		stepLabel: string;
		/** observer name -> css colour; empty in Watch mode, which is how you can tell. */
		observerColour: Record<string, string>;
	} = $props();

	const max = $derived(Math.max(1, ...rows.map((r) => Math.max(0, r.total))));
	const pct = (n: number) => `${(Math.max(0, n) / max) * 100}%`;
	const initials = (n: string) =>
		n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
	const fill = (s: LedgerRow['segments'][number]) =>
		s.kind === 'current' ? 'var(--rl-now)' : s.kind === 'observer' ? (observerColour[s.player ?? ''] ?? 'var(--rl-prior)') : 'var(--rl-prior)';
</script>

<div class="rl">
	<header class="rl-head">
		<span class="rl-av" title={currentVoter}>{initials(currentVoter)}</span>
		<span class="rl-who">{currentVoter}</span>
		<span class="rl-step">{stepLabel}</span>
	</header>

	<ol class="rl-rows">
		{#each rows as r, i (i)}
			<li class="rl-row" class:is-watched={r.isObserverSong}>
				<span class="rl-rank">{r.rank}</span>
				<span class="rl-prev">{r.prevRank === null ? '' : `[${r.prevRank}]`}</span>
				<span class="rl-song">
					<span class="rl-title">{r.title}</span>
					<span class="rl-meta">{r.artist} · {r.submitter}</span>
				</span>
				<span class="rl-track">
					{#each r.segments as s, j (j)}
						{#if s.points > 0}
							<span class="rl-seg" style:width={pct(s.points)} style:background={fill(s)}></span>
						{/if}
					{/each}
				</span>
				<span class="rl-total">{r.total}</span>
				<span class="rl-delta" class:is-neg={r.currentDelta < 0}>
					{r.currentDelta === 0 ? '' : (r.currentDelta > 0 ? `+${r.currentDelta}` : `${r.currentDelta}`)}
				</span>
			</li>
		{/each}
	</ol>

	<footer class="rl-legend">
		<span class="rl-leg"><i class="rl-sw" style:background="var(--rl-prior)"></i>everyone else, so far</span>
		{#each Object.entries(observerColour) as [name, col], i (i)}
			<span class="rl-leg"><i class="rl-sw" style:background={col}></i>{name}, already voted</span>
		{/each}
		<span class="rl-leg"><i class="rl-sw" style:background="var(--rl-now)"></i>this ballot</span>
		<span class="rl-leg rl-note">[n] = position before this ballot</span>
	</footer>
</div>

<style>
	.rl { --rl-prior: var(--line-strong, #6b7280); --rl-now: #e5484d; font-family: var(--font-mono); }
	.rl-head { display: flex; align-items: center; gap: 0.5rem; padding: 0 0 0.6rem; }
	.rl-av {
		display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 999px;
		background: var(--rl-now); color: #fff; font-size: 0.7rem; font-weight: 700;
	}
	.rl-who { font-weight: 600; }
	.rl-step { margin-left: auto; font-size: 0.75rem; color: var(--fg-quiet); }
	.rl-rows { list-style: none; margin: 0; padding: 0; }
	.rl-row {
		display: grid; grid-template-columns: 1.4rem 2.2rem minmax(8rem, 1fr) minmax(6rem, 1.4fr) 2.2rem 2.2rem;
		align-items: center; gap: 0.4rem; padding: 0.25rem 0.3rem; border-radius: 4px;
	}
	.rl-row.is-watched { background: color-mix(in oklch, var(--accent) 14%, transparent); }
	.rl-rank { color: var(--fg-quiet); text-align: right; }
	.rl-prev { color: var(--accent); font-size: 0.75rem; }
	.rl-song { display: flex; flex-direction: column; min-width: 0; }
	.rl-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rl-meta { font-size: 0.7rem; color: var(--fg-quiet); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rl-track { display: flex; height: 0.75rem; background: color-mix(in oklch, var(--fg-quiet) 12%, transparent); border-radius: 2px; overflow: hidden; }
	.rl-seg { display: block; height: 100%; }
	.rl-total { text-align: right; font-weight: 600; }
	.rl-delta { text-align: right; color: var(--rl-now); font-size: 0.78rem; }
	.rl-delta.is-neg { color: var(--sky, #3b82f6); }
	.rl-legend { display: flex; flex-wrap: wrap; gap: 0.75rem; padding-top: 0.7rem; font-size: 0.7rem; color: var(--fg-quiet); }
	.rl-leg { display: inline-flex; align-items: center; gap: 0.3rem; }
	.rl-sw { width: 0.7rem; height: 0.7rem; border-radius: 2px; }
</style>
