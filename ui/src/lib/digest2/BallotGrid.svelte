<script lang="ts">
	// "The Ballot Grid": voters × songs, every cell one vote. Compact enough for
	// a phone: faces instead of names, song numbers as columns, key underneath.
	import type { Digest2Ballot } from './ballot.js';
	let { ballot }: { ballot: Digest2Ballot } = $props();
	const initials = (n: string) => {
		const parts = n.split(/\s+/).filter((p) => /[a-z0-9]/i.test(p[0] ?? ''));
		return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
	};
	const anyBroke = $derived(ballot.grid.some((r) => r.broke));
	let picked = $state<string | null>(null);
</script>

<section class="grid-sec">
	<h2>The Ballot Grid</h2>
	<p class="cap">
		{ballot.gridCaption ?? 'Every ballot, laid bare. Read across for a person, down for a song. A dot means they left a comment; stripes are their own song.'}
	</p>
	<div class="legend">
		<span><i style="background:#2f7d3a"></i>+3</span><span><i style="background:#3f9a4bb0"></i>+2</span>
		<span><i style="background:#7cc47a40"></i>+1</span><span><i style="background:#e5534bd0"></i>−1</span>
		{#if anyBroke}<span><em class="tag">≠</em> off-book ballot</span>{/if}
	</div>
	<div class="wrap">
		<table>
			<thead>
				<tr><th></th>{#each ballot.songs as s (s.rank)}<th title="{s.title} — {s.artist}">{s.rank}</th>{/each}</tr>
			</thead>
			<tbody>
				{#each ballot.grid as row (row.voter)}
					<tr class:broke={row.broke} class:on={picked === row.voter}>
						<th>
							<button class="who" onclick={() => (picked = picked === row.voter ? null : row.voter)} title={row.voter}>
								{#if row.avatar}<span class="av {row.avatar}" role="img" aria-label={row.voter}></span>{:else}<span class="init">{initials(row.voter)}</span>{/if}
								{#if row.broke}<em class="tag" title="ballot: {row.ballot.join(' ')}">≠</em>{/if}
							</button>
						</th>
						{#each row.cells as c, i (i)}
							<td class="p{c.pts < 0 ? 'm' : c.pts}" class:own={c.own}>
								{#if !c.own && c.pts !== 0}{c.pts > 0 ? '+' : '−'}{Math.abs(c.pts)}{/if}{#if c.comment}<i></i>{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if picked}
		{@const row = ballot.grid.find((r) => r.voter === picked)}
		{#if row}<p class="picked"><b>{row.voter}</b>: {row.ballot.map((p) => (p > 0 ? '+' : '−') + Math.abs(p)).join(' · ')}</p>{/if}
	{/if}
	<ol class="key">
		{#each ballot.songs as s (s.rank)}<li><b>{s.rank}</b>{s.title} <span>· {s.submitter}</span></li>{/each}
	</ol>
</section>

<style>
	.grid-sec { margin: 2rem 0; }
	.cap { color: var(--fg-muted, #9aa4b1); font-size: .92rem; }
	.legend { display: flex; gap: 12px; flex-wrap: wrap; font: .75rem var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); margin: 8px 0; }
	.legend span { display: inline-flex; align-items: center; gap: 5px; }
	.legend i { width: 13px; height: 13px; border-radius: 3px; display: inline-block; }
	.wrap { overflow-x: auto; border: 1px solid var(--line, #262d37); border-radius: 12px; background: var(--surface, #11151b); padding: 4px; }
	table { border-collapse: separate; border-spacing: 2px; margin: 0 auto; font: 600 11px var(--font-mono, monospace); }
	thead th { color: var(--fg-muted, #8b96a5); font-weight: 500; padding: 4px 0; }
	tbody th { padding: 0 4px 0 0; position: sticky; left: 0; background: var(--surface, #11151b); }
	.who { position: relative; display: block; width: 28px; height: 28px; padding: 0; border: none; background: none; cursor: pointer; }
	.who .av, .who .init { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; object-fit: cover; }
	.who .init { background: #2a3340; color: #cfd6df; font: 700 9px var(--font-mono, monospace); border-radius: 6px; }
	tr.broke .who .av, tr.broke .who .init { outline: 2px solid #e5534b; outline-offset: 1px; }
	tr.on td { outline: 1px solid #ffffff55; }
	.tag { position: absolute; right: -4px; bottom: -4px; font: 800 9px/13px var(--font-mono, monospace); font-style: normal; color: #fff; background: #e5534b; border-radius: 6px; padding: 0 3px; }
	.legend .tag { position: static; }
	td { width: 26px; min-width: 26px; height: 26px; border-radius: 6px; text-align: center; position: relative; color: #e9edf2; }
	td.p3 { background: #2f7d3a; } td.p2 { background: #3f9a4bb0; } td.p1 { background: #7cc47a40; color: #cdeccb; }
	td.pm { background: #e5534bd0; } td.p0 { background: #ffffff06; }
	td.own { background: repeating-linear-gradient(45deg, #ffffff18 0 3px, transparent 3px 7px); }
	td i { position: absolute; top: 2px; right: 2px; width: 5px; height: 5px; border-radius: 50%; background: #fff; opacity: .85; }
	.picked { font: .8rem var(--font-mono, monospace); margin: 8px 0 0; }
	.key { list-style: none; padding: 0; margin: 10px 0 0; columns: 2; font-size: .82rem; }
	.key li { break-inside: avoid; margin: 2px 0; }
	.key b { display: inline-block; width: 22px; font: 600 .75rem var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); }
	.key span { color: var(--fg-muted, #8b96a5); }
	@media (max-width: 520px) { .key { columns: 1; } }
</style>
