<script lang="ts">
	import { toPng } from 'html-to-image';
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
	let selectedKeys = $state((snap.deep?.players ?? []).slice(0, 3).map((player) => player.key));
	let activeTrait = $state<FingerprintTrait>('chaos');
	let failedAvatarKeys = $state(new Set<string>());
	let cardBusyKey = $state<string | null>(null);
	let cardStatus = $state<Record<string, string>>({});
	$effect(() => {
		const validKeys = selectedKeys.filter((key) => allPlayers.some((player) => player.key === key)).slice(0, 3);
		if (validKeys.length !== selectedKeys.length || validKeys.some((key, index) => key !== selectedKeys[index])) {
			selectedKeys = validKeys;
		}
	});
	const selected = $derived(selectedKeys.map((key) => allPlayers.find((p) => p.key === key)).filter((p): p is Player => !!p));
	const active = $derived(traits.find((trait) => trait.key === activeTrait) ?? traits[0]);
	const palette = (player: Player) => snap.colors[Math.max(0, snap.competitors.findIndex((c) => c.id === player.competitorId)) % snap.colors.length] ?? '#a78bfa';
	const score = (player: Player, trait: Trait) => Number(player[trait.field] ?? 0);
	const avatarFiles: Record<string, string> = {
		mashew: '/boarz/avatars/mashew.png',
		'jonathan black': '/boarz/avatars/jonathan-black.png',
		'cj wookie': '/boarz/avatars/cj-wookie.png',
	};
	function normalizeName(value: string | undefined) {
		return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	}
	function avatarFor(player: Player) {
		const competitor = snap.competitors.find((item) => item.id === player.competitorId);
		for (const name of [player.display, competitor?.name, competitor?.botName, player.key]) {
			const file = avatarFiles[normalizeName(name)];
			if (file) return file;
		}
		return undefined;
	}
	function initials(name: string) {
		return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
	}
	function fileSlug(value: string) {
		return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
	}
	async function renderPlayerCard(card: HTMLElement) {
		return toPng(card, {
			pixelRatio: 2,
			cacheBust: true,
			skipFonts: true,
			backgroundColor: '#0b101a',
			height: card.scrollHeight,
			filter: (candidate) => !(candidate instanceof HTMLElement) || candidate.dataset.noshot !== '1',
		});
	}
	function savePng(dataUrl: string, player: Player) {
		const link = document.createElement('a');
		link.download = `boarz-${fileSlug(player.display)}-fingerprint.png`;
		link.href = dataUrl;
		link.click();
	}
	function showCardStatus(key: string, message: string) {
		cardStatus = { ...cardStatus, [key]: message };
		window.setTimeout(() => {
			if (cardStatus[key] === message) {
				const next = { ...cardStatus };
				delete next[key];
				cardStatus = next;
			}
		}, 2200);
	}
	async function downloadFingerprint(event: MouseEvent, player: Player) {
		if (cardBusyKey) return;
		const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-player-card]');
		if (!card) return;
		cardBusyKey = player.key;
		try {
			savePng(await renderPlayerCard(card), player);
			showCardStatus(player.key, 'PNG saved');
		} catch (error) {
			console.error('[boarz-stats] player fingerprint PNG export failed', error);
			showCardStatus(player.key, 'Could not export image');
		} finally {
			cardBusyKey = null;
		}
	}
	async function shareFingerprint(event: MouseEvent, player: Player) {
		if (cardBusyKey) return;
		const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-player-card]');
		if (!card) return;
		cardBusyKey = player.key;
		try {
			const dataUrl = await renderPlayerCard(card);
			const blob = await (await fetch(dataUrl)).blob();
			const file = new File([blob], `boarz-${fileSlug(player.display)}-fingerprint.png`, { type: 'image/png' });
			const nav = navigator as Navigator & {
				canShare?: (data: { files?: File[] }) => boolean;
				share?: (data: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
			};
			if (nav.share && nav.canShare?.({ files: [file] })) {
				await nav.share({ files: [file], title: `${player.display} · Boarz Stats`, text: `${player.display}'s chat fingerprint` });
				showCardStatus(player.key, 'Shared');
			} else {
				savePng(dataUrl, player);
				showCardStatus(player.key, 'PNG saved · attach it to share');
			}
		} catch (error) {
			// Dismissing the native share sheet is normal; only report export failures.
			if (error instanceof DOMException && error.name === 'AbortError') return;
			console.error('[boarz-stats] player fingerprint share failed', error);
			showCardStatus(player.key, 'Could not share image');
		} finally {
			cardBusyKey = null;
		}
	}
	function archetype(player: Player) {
		const top = [...traits].sort((a, b) => score(player, b) - score(player, a))[0];
		const names: Record<FingerprintTrait, string> = {
			heat: 'The Pot-Stirrer', chaos: 'The Wild Card', affection: 'The Softie',
			mainCharacter: 'The Scene-Stealer', commissioner: 'The Commissioner', meme: 'The Wordsmith',
		};
		return names[top.key];
	}
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
			<article class="profile-card" data-player-card={player.key} style={`--player:${palette(player)}`}>
				<div class="card-head">
					<div class="identity">
						<div class="avatar" aria-hidden="true">
							{#if avatarFor(player) && !failedAvatarKeys.has(player.key)}
								<img src={avatarFor(player)} alt="" onerror={() => failedAvatarKeys = new Set([...failedAvatarKeys, player.key])} />
							{:else}<span>{initials(player.display)}</span>{/if}
						</div>
						<div class="identity-copy"><div class="card-kicker">PLAYER FINGERPRINT</div><h3>{player.display}</h3><div class="archetype">{archetype(player)}</div><div class="card-context">{snap.league.name} · {snap.league.season}</div><p>{player.msgsRated.toLocaleString()} rated messages</p></div>
					</div>
					<div class="card-actions" data-noshot="1">
						<button class="share-action" type="button" title={`Download ${player.display}'s fingerprint as PNG`} aria-label={`Download ${player.display}'s fingerprint as PNG`} disabled={cardBusyKey !== null} onclick={(event) => downloadFingerprint(event, player)}>{cardBusyKey === player.key ? 'Saving…' : '↓ PNG'}</button>
						<button class="share-action share-primary" type="button" title={`Share ${player.display}'s fingerprint image`} aria-label={`Share ${player.display}'s fingerprint image`} disabled={cardBusyKey !== null} onclick={(event) => shareFingerprint(event, player)}>{cardBusyKey === player.key ? 'Saving…' : '↗ Share'}</button>
						<span class="crown" aria-hidden="true">✦</span>
					</div>
				</div>
				{#if cardStatus[player.key]}<p class="card-status" aria-live="polite" data-noshot="1">{cardStatus[player.key]}</p>{/if}
				<div class="radar-wrap">
					<svg viewBox="0 0 220 204" role="img" aria-label={`${player.display} trait fingerprint. Select a point to view message evidence.`}>
						{#each [0.33, 0.66, 1] as ring}
							<polygon points={traits.map((_, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / traits.length; return `${110 + Math.cos(a) * 72 * ring},${102 + Math.sin(a) * 72 * ring}`; }).join(' ')} class="grid-ring" fill="none" stroke="#60708a66" stroke-width="1" />
						{/each}
						{#each traits as trait, i (trait.key)}
							{@const end = radarPoint(player, i)}
							{@const labelAngle = -Math.PI / 2 + i * Math.PI * 2 / traits.length}
							<line x1="110" y1="102" x2={110 + Math.cos(labelAngle) * 72} y2={102 + Math.sin(labelAngle) * 72} class="spoke" stroke="#60708a88" stroke-width="1" />
							<g class:active-dot={activeTrait === trait.key} role="button" tabindex="0" aria-label={`Show ${trait.title} message evidence`} onclick={() => activeTrait = trait.key} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeTrait = trait.key; }}>
								<circle cx={end.x} cy={end.y} r="15" class="hit-area" fill="transparent" />
								<circle cx={end.x} cy={end.y} r="5.5" class="trait-dot" fill={palette(player)} stroke="white" stroke-width="1.5" />
							</g>
						{/each}
						<polygon points={radarPolygon(player)} fill={palette(player)} fill-opacity="0.24" stroke={palette(player)} stroke-width="2.4" stroke-linejoin="round" />
						{#each traits as trait, i (trait.key)}
							{@const end = radarPoint(player, i)}
							<circle cx={end.x} cy={end.y} r={activeTrait === trait.key ? 7 : 5.5} class="trait-dot top-dot" fill="white" stroke={palette(player)} stroke-width="3" onclick={() => activeTrait = trait.key} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeTrait = trait.key; }} role="button" tabindex="0" aria-label={`${trait.title}: ${Math.round(score(player, trait) * 100)}th relative score`} />
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
	.fingerprint-shell{margin-top:1.5rem;overflow:hidden;border:1px solid #253047;border-radius:1.25rem;background:radial-gradient(ellipse at 50% -30%,#28203f 0%,#101522 48%,#0b101a 100%);color:#f5f6fb;padding:1.25rem;box-shadow:0 18px 50px #03071266;position:relative}.fingerprint-shell:before{content:"";position:absolute;inset:0 0 auto;height:9rem;pointer-events:none;opacity:.22;background-image:radial-gradient(#a78bfa 1px,transparent 1.4px);background-size:18px 18px;mask-image:linear-gradient(115deg,#000,transparent 67%)}
	.intro-row,.card-head,.evidence-heading,.evidence-person-head{display:flex;justify-content:space-between;align-items:center;gap:1rem}.intro-row,.player-picker,.cards,.evidence-panel{position:relative}.intro-row h2{font-size:clamp(1.6rem,3vw,2.25rem);font-weight:800;letter-spacing:-.045em;background:linear-gradient(100deg,#fff 15%,#ffd09a 65%,#f08b68);color:transparent;background-clip:text}
	h2,h3,p{margin:0}.muted,.card-head p{color:#a6b1c7;font-size:.85rem;margin-top:.2rem}.eyebrow,.card-kicker{color:#bb9aff;font-size:.64rem;font-weight:800;letter-spacing:.16em;margin-bottom:.35rem}.selection-hint{color:#c3cbda;font-size:.78rem}.selection-hint span{background:#261d3b;color:#d6bcff;border-radius:999px;padding:.25rem .55rem;margin-left:.3rem}.clear-selection{margin-left:.55rem;border:1px solid #566078;border-radius:999px;background:#1a2231;color:#e1e7f2;padding:.2rem .55rem;font-size:.7rem}.clear-selection:hover{border-color:#c4a5ff;background:#282039}.empty-selection{margin:.25rem 0 .8rem;padding:1.2rem;border:1px dashed #46516a;border-radius:.8rem;color:#aab5c8;text-align:center;font-size:.85rem}
	.player-picker{display:flex;flex-wrap:wrap;gap:.4rem;margin:1rem 0 1.1rem}.player-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.42rem .68rem;border-radius:999px;border:1px solid #29344a;background:#111927;color:#bec8d9;font-size:.78rem;transition:.15s}.player-chip:hover,.player-chip.chosen{border-color:var(--player,#a78bfa);color:white;background:#1a2234}.dot{width:.55rem;height:.55rem;border-radius:50%;background:var(--player)}
	.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:.8rem}.profile-card{border:1px solid color-mix(in srgb,var(--player) 45%,#273347);background:linear-gradient(145deg,color-mix(in srgb,var(--player) 10%,#141927),#0c121d 68%);border-radius:1rem;padding:.95rem;min-width:0}.card-head{align-items:flex-start}.identity{display:flex;align-items:center;gap:.78rem;min-width:0}.identity-copy{min-width:0}.card-head h3{font-size:1.22rem;line-height:1.1;overflow-wrap:anywhere}.card-kicker{font-size:.58rem}.archetype{margin-top:.17rem;color:var(--player);font-size:.8rem;font-weight:700;font-style:italic}.card-context{margin-top:.18rem;color:#a9b2c5;font-size:.64rem}.avatar{width:4rem;height:4rem;flex:0 0 4rem;border-radius:50%;overflow:hidden;border:2px solid var(--player);background:radial-gradient(circle at 35% 25%,color-mix(in srgb,var(--player) 65%,white),#171a27 70%);box-shadow:0 0 0 4px color-mix(in srgb,var(--player) 15%,transparent),0 5px 18px #0007;display:grid;place-items:center}.avatar img{width:100%;height:100%;object-fit:cover;object-position:center 35%;display:block}.avatar span{color:white;font-size:1rem;font-weight:800;letter-spacing:.04em}.card-actions{display:flex;align-items:center;gap:.28rem;flex:0 0 auto}.share-action{border:1px solid #536078;border-radius:999px;background:#182131;color:#cbd5e6;padding:.3rem .48rem;font-size:.65rem;font-weight:700;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}.share-action:hover:not(:disabled){border-color:var(--player);background:color-mix(in srgb,var(--player) 18%,#182131);color:white}.share-action:disabled{opacity:.65;cursor:wait}.share-primary{border-color:color-mix(in srgb,var(--player) 65%,#526078);color:white}.crown{font-size:1.05rem;color:var(--player);background:#ffffff0b;border-radius:.65rem;padding:.22rem .38rem}.card-status{margin:.5rem 0 0 auto;text-align:right;color:#c5cede;font-size:.67rem}.radar-wrap{max-width:270px;height:210px;margin:.25rem auto 0}.radar-wrap svg{width:100%;height:100%;overflow:visible}.grid-ring{fill:none;stroke:#60708a66;stroke-width:1}.spoke{stroke:#60708a55;stroke-width:1}.trait-dot{fill:var(--player);stroke:#fff;stroke-width:1.5;cursor:pointer}.hit-area{fill:transparent;cursor:pointer}.active-dot .trait-dot,.trait-dot:hover{r:7}.top-dot{fill:#fff;stroke:var(--player);stroke-width:3}.trait-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.3rem}.trait-line{display:flex;align-items:center;gap:.4rem;text-align:left;padding:.38rem;border-radius:.55rem;color:#c5cede;background:transparent;min-width:0}.trait-line:hover,.trait-line.trait-selected{background:#ffffff0d;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--player) 35%,transparent)}.trait-icon{color:var(--player);font-size:1.12rem;width:1.15rem;text-align:center}.trait-copy{display:flex;flex-direction:column;min-width:0;flex:1}.trait-copy b{font-size:.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trait-copy small{font-size:.6rem;color:#8794aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trait-line strong{font-size:.74rem;color:var(--player);font-variant-numeric:tabular-nums}
	.evidence-panel{margin-top:1rem;border:1px solid #322747;border-radius:1rem;background:linear-gradient(135deg,#171625,#101722);padding:1rem}.evidence-heading{align-items:flex-start;margin-bottom:.85rem}.evidence-heading h3{font-size:1.12rem}.evidence-heading h3 span{color:#d29fff}.evidence-heading h3 small{display:block;margin:.18rem 0 0 1.7rem;font-size:.72rem;font-weight:400;color:#9ea9be}.explanation{max-width:34rem;color:#d1c4e7;font-size:.8rem;line-height:1.5}.evidence-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,235px),1fr));gap:.6rem}.evidence-person{min-width:0;border:1px solid color-mix(in srgb,var(--player) 42%,#283347);border-radius:.75rem;padding:.65rem;background:#0b111bd9}.evidence-person-head{margin-bottom:.55rem;font-size:.82rem}.evidence-person-head b{color:var(--player)}.evidence-person-head span{font-size:.67rem;color:#abb6c9}.evidence-person blockquote{margin:.4rem 0 0;padding:.65rem;border-radius:.6rem;background:#171f2d;color:#dce2ed;font-size:.79rem;line-height:1.45}.evidence-person blockquote.lower-signal{background:#111824;color:#b8c2d1}.evidence-label{display:block;margin-bottom:.25rem;color:var(--player);font-size:.61rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.evidence-person footer{margin-top:.45rem;color:#92a0b6;font-size:.64rem}.no-evidence,.method-note{color:#9ba7ba;font-size:.72rem}.method-note{margin-top:.75rem}.evidence-person blockquote:first-of-type{margin-top:0}
	@media(max-width:650px){.fingerprint-shell{padding:.8rem}.intro-row,.evidence-heading{align-items:flex-start;flex-direction:column}.selection-hint{align-self:flex-end;margin-top:-.2rem}.trait-grid{gap:.2rem}.trait-line{padding:.3rem}.cards{grid-template-columns:1fr}}
</style>
