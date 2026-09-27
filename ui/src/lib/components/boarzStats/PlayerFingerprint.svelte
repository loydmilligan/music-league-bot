<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import type { FingerprintTrait } from '$lib/server/boarzStats/deepRatings.js';

	let { snap }: { snap: Snapshot } = $props();
	type Player = NonNullable<Snapshot['deep']>['players'][number];
	type Trait = { key: FingerprintTrait; title: string; subtitle: string; icon: string; field: keyof Player };
	const traits: Trait[] = [
		{ key: 'heat', title: 'Spice', subtitle: 'Stirs the pot', icon: '♨', field: 'pctHeat' },
		{ key: 'chaos', title: 'Chaos', subtitle: 'Embraces the madness', icon: '◉', field: 'pctChaos' },
		{ key: 'affection', title: 'Vibes', subtitle: 'Feels it all', icon: '♥', field: 'pctAffection' },
		{ key: 'mainCharacter', title: 'Main Character', subtitle: 'Owns the room', icon: '♛', field: 'pctMainCharacter' },
		{ key: 'commissioner', title: 'Commissioner', subtitle: 'Keeps the league moving', icon: '✦', field: 'pctCommissioner' },
		{ key: 'meme', title: 'Word Salad', subtitle: 'Makes the moment', icon: '…', field: 'pctMeme' },
	];
	const allPlayers = $derived(snap.deep?.players ?? []);
	let selectedKeys = $state<string[]>([]);
	let initialized = $state(false);
	let activeTrait = $state<FingerprintTrait>('chaos');
	$effect(() => {
		if (!initialized && allPlayers.length) {
			selectedKeys = allPlayers.slice(0, Math.min(3, allPlayers.length)).map((p) => p.key);
			initialized = true;
		} else {
			selectedKeys = selectedKeys.filter((key) => allPlayers.some((p) => p.key === key)).slice(0, 3);
		}
	});
	const selected = $derived(selectedKeys.map((key) => allPlayers.find((p) => p.key === key)).filter((p): p is Player => !!p));
	const active = $derived(traits.find((trait) => trait.key === activeTrait) ?? traits[0]);
	const palette = (player: Player) => snap.colors[Math.max(0, snap.competitors.findIndex((c) => c.id === player.competitorId)) % snap.colors.length] ?? '#a78bfa';
	const score = (player: Player, trait: Trait) => Number(player[trait.field] ?? 0);
	function toggle(key: string) {
		if (selectedKeys.includes(key)) selectedKeys = selectedKeys.filter((item) => item !== key);
		else if (selectedKeys.length < 3) selectedKeys = [...selectedKeys, key];
	}
	function radarPoint(player: Player, index: number) {
		const angle = -Math.PI / 2 + (index * Math.PI * 2) / traits.length;
		const radius = 72 * score(player, traits[index]);
		return { x: 110 + Math.cos(angle) * radius, y: 102 + Math.sin(angle) * radius };
	}
	function radarPolygon(player: Player) {
		return traits.map((_, i) => { const p = radarPoint(player, i); return `${p.x},${p.y}`; }).join(' ');
	}
	function leadLine() {
		if (selected.length < 2) return 'Select another player to compare the evidence behind this trait.';
		const ordered = [...selected].sort((a, b) => score(b, active) - score(a, active));
		const gap = score(ordered[0], active) - score(ordered[ordered.length - 1], active);
		if (gap < 0.04) return `${ordered.map((p) => p.display).join(' and ')} land close together on ${active.title}; the messages show different flavors of the same trait.`;
		return `${ordered[0].display} leads ${active.title} by ${(gap * 100).toFixed(0)} points on this player-relative scale. The messages below are the strongest rated examples for each player.`;
	}
</script>

<section class="fingerprint-shell" aria-labelledby="fingerprint-title">
	<div class="intro-row">
		<div>
			<p class="eyebrow">BEHAVIORAL SCOUTING REPORT</p>
			<h2 id="fingerprint-title">The chat fingerprint</h2>
			<p class="muted">A personality readout built from rated messages—not just a shape on a chart.</p>
		</div>
		<div class="selection-hint">Choose up to 3 players <span>{selected.length}/3</span>{#if selected.length}<button class="clear-selection" onclick={() => selectedKeys = []}>Clear</button>{/if}</div>
	</div>

	<div class="player-picker" aria-label="Choose players to profile">
		{#each allPlayers as player (player.key)}
			<button class:chosen={selectedKeys.includes(player.key)} class="player-chip" onclick={() => toggle(player.key)} aria-pressed={selectedKeys.includes(player.key)}>
				<span class="dot" style={`--player:${palette(player)}`}></span>{player.display}
			</button>
		{/each}
	</div>

	<div class="cards">
		{#each selected as player (player.key)}
			<article class="profile-card" style={`--player:${palette(player)}`}>
				<div class="card-head">
					<div><div class="card-kicker">PLAYER FINGERPRINT</div><h3>{player.display}</h3><p>{player.msgsRated.toLocaleString()} rated messages</p></div>
					<div class="crown">✦</div>
				</div>
				<div class="radar-wrap">
					<svg viewBox="0 0 220 204" role="img" aria-label={`${player.display} trait fingerprint. Select a point to view message evidence.`}>
						{#each [0.33, 0.66, 1] as ring}
							<polygon points={traits.map((_, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / traits.length; return `${110 + Math.cos(a) * 72 * ring},${102 + Math.sin(a) * 72 * ring}`; }).join(' ')} class="grid-ring" />
						{/each}
						{#each traits as trait, i (trait.key)}
							{@const end = radarPoint(player, i)}
							{@const labelAngle = -Math.PI / 2 + i * Math.PI * 2 / traits.length}
							<line x1="110" y1="102" x2={110 + Math.cos(labelAngle) * 72} y2={102 + Math.sin(labelAngle) * 72} class="spoke" />
							<g class:active-dot={activeTrait === trait.key} role="button" tabindex="0" aria-label={`Show ${trait.title} message evidence`} onclick={() => activeTrait = trait.key} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeTrait = trait.key; }}>
								<circle cx={end.x} cy={end.y} r="15" class="hit-area" />
								<circle cx={end.x} cy={end.y} r="5.5" class="trait-dot" />
							</g>
						{/each}
						<polygon points={radarPolygon(player)} class="trait-area" />
						{#each traits as trait, i (trait.key)}
							{@const end = radarPoint(player, i)}
							<circle cx={end.x} cy={end.y} r="5.5" class="trait-dot top-dot" onclick={() => activeTrait = trait.key} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeTrait = trait.key; }} role="button" tabindex="0" aria-label={`${trait.title}: ${Math.round(score(player, trait) * 100)}th relative score`} />
						{/each}
					</svg>
				</div>
				<div class="trait-grid">
					{#each traits as trait (trait.key)}
						<button class:trait-selected={activeTrait === trait.key} class="trait-line" onclick={() => activeTrait = trait.key}>
							<span class="trait-icon">{trait.icon}</span><span class="trait-copy"><b>{trait.title}</b><small>{trait.subtitle}</small></span><strong>{Math.round(score(player, trait) * 100)}</strong>
						</button>
					{/each}
				</div>
			</article>
		{/each}
	</div>
	{#if !selected.length}
		<p class="empty-selection">No players selected. Choose a player above to start a profile or comparison.</p>
	{/if}

	{#if selected.length}
		<div class="evidence-panel">
			<div class="evidence-heading">
				<div><p class="eyebrow">THE RECEIPTS</p><h3><span>{active.icon}</span> {active.title} <small>{active.subtitle}</small></h3></div>
				<p class="explanation">{leadLine()}</p>
			</div>
			<div class="evidence-columns">
				{#each selected as player (player.key)}
					<div class="evidence-person" style={`--player:${palette(player)}`}>
						<div class="evidence-person-head"><b>{player.display}</b><span>{Math.round(score(player, active) * 100)} relative</span></div>
						{#if player.evidence[activeTrait]?.high.length || player.evidence[activeTrait]?.low}
							{#each player.evidence[activeTrait]?.high ?? [] as item, i (item.ts + item.text)}
								<blockquote><span class="evidence-label">{i === 0 ? 'Strongest signal' : 'Another strong signal'}</span>“{item.text}”<footer>Rated {item.score.toFixed(1)} / 3 · {new Date(item.ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</footer></blockquote>
							{/each}
							{@const low = player.evidence[activeTrait]?.low}
							{#if low && !player.evidence[activeTrait].high.some((item) => item.ts === low.ts && item.text === low.text)}
								<blockquote class="lower-signal"><span class="evidence-label">Lower-scoring example</span>“{low.text}”<footer>Rated {low.score.toFixed(1)} / 3 · {new Date(low.ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</footer></blockquote>
							{/if}
						{:else}<p class="no-evidence">No rated message examples for this trait yet.</p>{/if}
					</div>
				{/each}
			</div>
			<p class="method-note">Trait scores are stretched across this roster for readability. Message receipts are the highest individual ratings in the available Boarz chat data; they illustrate a trait, but are not necessarily typical.</p>
		</div>
	{/if}
</section>

<style>
	.fingerprint-shell{margin-top:1.5rem;overflow:hidden;border:1px solid #253047;border-radius:1.25rem;background:radial-gradient(ellipse at 50% -30%,#28203f 0%,#101522 48%,#0b101a 100%);color:#f5f6fb;padding:1.25rem;box-shadow:0 18px 50px #03071266}
	.intro-row,.card-head,.evidence-heading,.evidence-person-head{display:flex;justify-content:space-between;align-items:center;gap:1rem}
	h2,h3,p{margin:0}.intro-row h2{font-size:1.45rem;font-weight:750;letter-spacing:-.03em}.muted,.card-head p{color:#a6b1c7;font-size:.85rem;margin-top:.2rem}.eyebrow,.card-kicker{color:#bb9aff;font-size:.64rem;font-weight:800;letter-spacing:.16em;margin-bottom:.35rem}.selection-hint{color:#c3cbda;font-size:.78rem}.selection-hint span{background:#261d3b;color:#d6bcff;border-radius:999px;padding:.25rem .55rem;margin-left:.3rem}.clear-selection{margin-left:.55rem;border:1px solid #566078;border-radius:999px;background:#1a2231;color:#e1e7f2;padding:.2rem .55rem;font-size:.7rem}.clear-selection:hover{border-color:#c4a5ff;background:#282039}.empty-selection{margin:.25rem 0 .8rem;padding:1.2rem;border:1px dashed #46516a;border-radius:.8rem;color:#aab5c8;text-align:center;font-size:.85rem}
	.player-picker{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0 1.1rem}.player-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.42rem .68rem;border-radius:999px;border:1px solid #29344a;background:#111927;color:#bec8d9;font-size:.78rem;transition:.15s}.player-chip:hover,.player-chip.chosen{border-color:var(--player,#a78bfa);color:white;background:#1a2234}.dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--player)}
	.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:.8rem}.profile-card{border:1px solid color-mix(in srgb,var(--player) 45%,#273347);background:linear-gradient(145deg,color-mix(in srgb,var(--player) 10%,#141927),#0c121d 68%);border-radius:1rem;padding:.95rem;min-width:0}.card-head h3{font-size:1.22rem;line-height:1.1}.card-kicker{font-size:.58rem}.crown{font-size:1.35rem;color:var(--player);background:#ffffff0b;border-radius:.65rem;padding:.25rem .48rem}.radar-wrap{max-width:270px;height:210px;margin:.25rem auto 0}.radar-wrap svg{width:100%;height:100%;overflow:visible}.grid-ring{fill:none;stroke:#60708a66;stroke-width:1}.spoke{stroke:#60708a55;stroke-width:1}.trait-area{fill:color-mix(in srgb,var(--player) 26%,transparent);stroke:var(--player);stroke-width:2.4;stroke-linejoin:round;filter:drop-shadow(0 0 5px color-mix(in srgb,var(--player) 55%,transparent))}.trait-dot{fill:var(--player);stroke:#fff;stroke-width:1.5;cursor:pointer}.hit-area{fill:transparent;cursor:pointer}.active-dot .trait-dot,.trait-dot:hover{r:7}.top-dot{fill:#fff;stroke:var(--player);stroke-width:3}.trait-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.3rem}.trait-line{display:flex;align-items:center;gap:.4rem;text-align:left;padding:.38rem;border-radius:.55rem;color:#c5cede;background:transparent;min-width:0}.trait-line:hover,.trait-line.trait-selected{background:#ffffff0d;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--player) 35%,transparent)}.trait-icon{color:var(--player);font-size:1.12rem;width:1.15rem;text-align:center}.trait-copy{display:flex;flex-direction:column;min-width:0;flex:1}.trait-copy b{font-size:.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trait-copy small{font-size:.6rem;color:#8794aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trait-line strong{font-size:.74rem;color:var(--player);font-variant-numeric:tabular-nums}
	.evidence-panel{margin-top:1rem;border:1px solid #322747;border-radius:1rem;background:linear-gradient(135deg,#171625,#101722);padding:1rem}.evidence-heading{align-items:flex-start;margin-bottom:.85rem}.evidence-heading h3{font-size:1.12rem}.evidence-heading h3 span{color:#d29fff}.evidence-heading h3 small{display:block;margin:.18rem 0 0 1.7rem;font-size:.72rem;font-weight:400;color:#9ea9be}.explanation{max-width:34rem;color:#d1c4e7;font-size:.8rem;line-height:1.5}.evidence-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,235px),1fr));gap:.6rem}.evidence-person{min-width:0;border:1px solid color-mix(in srgb,var(--player) 42%,#283347);border-radius:.75rem;padding:.65rem;background:#0b111bd9}.evidence-person-head{margin-bottom:.55rem;font-size:.82rem}.evidence-person-head b{color:var(--player)}.evidence-person-head span{font-size:.67rem;color:#abb6c9}.evidence-person blockquote{margin:.4rem 0 0;padding:.65rem;border-radius:.6rem;background:#171f2d;color:#dce2ed;font-size:.79rem;line-height:1.45}.evidence-person blockquote.lower-signal{background:#111824;color:#b8c2d1}.evidence-label{display:block;margin-bottom:.25rem;color:var(--player);font-size:.61rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.evidence-person footer{margin-top:.45rem;color:#92a0b6;font-size:.64rem}.no-evidence,.method-note{color:#9ba7ba;font-size:.72rem}.method-note{margin-top:.75rem}.evidence-person blockquote:first-of-type{margin-top:0}
	@media(max-width:650px){.fingerprint-shell{padding:.8rem}.intro-row,.evidence-heading{align-items:flex-start;flex-direction:column}.selection-hint{align-self:flex-end;margin-top:-.2rem}.trait-grid{gap:.2rem}.trait-line{padding:.3rem}.cards{grid-template-columns:1fr}}
</style>
