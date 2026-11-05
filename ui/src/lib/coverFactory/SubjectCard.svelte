<script lang="ts">
	import type { Breakdown, Player, Treatment } from './api';
	import { headshotUrl } from './api';

	type Subject = Breakdown['subjects'][number];
	let {
		subject = $bindable(),
		treatment = $bindable(),
		players,
		index,
		uploading = false,
		selected = false,
		domId,
		onchange,
		onlabel,
		onupload,
		onselect,
		onideas,
	}: {
		subject: Subject;
		treatment: Treatment;
		players: Player[];
		index: number;
		uploading?: boolean;
		selected?: boolean;
		domId?: string;
		onchange: () => void;
		onlabel: (oldLabel: string, newLabel: string) => void;
		onupload: (slug: string, file: File) => void;
		onselect?: () => void;
		/** Gag ideas from the player's profile (one paid call, cached server-side). */
		onideas?: (slug: string) => Promise<string[]>;
	} = $props();

	const MODES: { id: Treatment['mode']; label: string; hint: string }[] = [
		{ id: 'player', label: 'Player', hint: 'Swap in a league player' },
		{ id: 'keep', label: 'Keep', hint: 'Leave as on the original' },
		{ id: 'remove', label: 'Remove', hint: 'Erase and fill naturally' },
	];
	const uid = $props.id();
	const player = $derived(players.find((p) => p.slug === treatment.playerSlug));
	const leagues = $derived([...new Set(players.map((p) => p.leagueSlug))]);
	let detailsOpen = $state(false);
	let ideas = $state<{ slug: string; list: string[] } | null>(null);
	let ideasLoading = $state(false);
	let ideasError = $state('');
	const shownIdeas = $derived(ideas && ideas.slug === player?.slug ? ideas.list : []);

	async function loadIdeas() {
		if (!player || !onideas) return;
		const slug = player.slug;
		ideasLoading = true;
		ideasError = '';
		try {
			const list = await onideas(slug);
			ideas = { slug, list };
			if (!list.length) ideasError = `No profile on file for ${player.name}.`;
		} catch (e) {
			ideasError = e instanceof Error ? e.message : 'ideas failed';
		} finally {
			ideasLoading = false;
		}
	}
	function useIdea(idea: string) {
		const cur = (treatment.notes ?? '').trim();
		if (cur.toLowerCase().includes(idea.toLowerCase())) return;
		treatment.notes = cur ? `${cur}; ${idea}` : idea;
		onchange();
	}

	function setMode(m: Treatment['mode']) {
		treatment.mode = m;
		onchange();
	}
	function setPlayer(slug: string) {
		const p = players.find((x) => x.slug === slug);
		treatment.playerSlug = p?.slug;
		treatment.playerName = p?.name;
		onchange();
	}

	const field =
		'w-full font-sans bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none';
	const lbl = 'flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint';
	const roleTone: Record<string, string> = {
		main: 'text-accent border-accent-deep bg-accent-bg',
		secondary: 'text-amber border-amber/40 bg-amber/10',
		background: 'text-sky border-sky/40 bg-sky-bg',
	};
</script>

<article
	id={domId}
	class="rounded-md border bg-bg-elevated p-3 space-y-3 scroll-mt-4 transition-[border-color,box-shadow] {treatment.mode === 'player'
		? 'border-accent-deep'
		: 'border-border-muted'} {selected ? 'ring-2 ring-fg/70 ring-offset-2 ring-offset-surface' : ''}"
	aria-labelledby="{uid}-h"
	aria-current={selected ? 'true' : undefined}
	onfocusin={() => !selected && onselect?.()}
>
	<header class="flex flex-wrap items-start gap-3">
		<button
			type="button"
			class="font-mono text-xs pt-1 {selected ? 'text-fg' : 'text-fg-faint hover:text-fg-dim'}"
			title={subject.box ? 'Show on the cover' : 'No box on the cover yet'}
			aria-label="Select subject {subject.label}"
			onclick={() => onselect?.()}>{String(index + 1).padStart(2, '0')}</button
		>
		<div class="flex-1 min-w-48 space-y-1">
			<h4 id="{uid}-h" class="sr-only">Subject {subject.label}</h4>
			<input
				class="w-full bg-transparent border-b border-transparent hover:border-border focus:border-accent focus:outline-none font-display text-lg text-fg"
				aria-label="Subject label"
				value={subject.label}
				onchange={(e) => {
					const next = (e.currentTarget as HTMLInputElement).value.trim();
					if (next && next !== subject.label) onlabel(subject.label, next);
				}}
			/>
			<div class="flex flex-wrap items-center gap-1.5">
				<select
					class="bg-transparent border rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider {roleTone[subject.role] ?? roleTone.background}"
					aria-label="Role"
					bind:value={subject.role}
					onchange={onchange}
				>
					<option value="main">main</option>
					<option value="secondary">secondary</option>
					<option value="background">background</option>
				</select>
				<select
					class="bg-transparent border border-border-muted rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-dim"
					aria-label="Kind"
					bind:value={subject.kind}
					onchange={onchange}
				>
					<option value="person">person</option>
					<option value="animal">animal</option>
					<option value="object">object</option>
				</select>
				<span class="text-xs text-fg-dim line-clamp-1">{subject.position}</span>
			</div>
		</div>
		<div class="inline-flex rounded-md border border-border overflow-hidden" role="radiogroup" aria-label="Treatment for {subject.label}">
			{#each MODES as m (m.id)}
				<button
					type="button"
					role="radio"
					aria-checked={treatment.mode === m.id}
					title={m.hint}
					class="px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors {treatment.mode === m.id
						? m.id === 'player'
							? 'bg-accent text-bg'
							: m.id === 'remove'
								? 'bg-ember-bg text-ember'
								: 'bg-surface-strong text-fg'
						: 'text-fg-dim hover:text-fg hover:bg-surface'}"
					onclick={() => setMode(m.id)}>{m.label}</button
				>
			{/each}
		</div>
	</header>

	{#if treatment.mode === 'player'}
		<div class="grid gap-3 sm:grid-cols-[auto_1fr] items-start">
			<div class="w-20 h-20 rounded-md border border-border bg-surface overflow-hidden grid place-items-center">
				{#if player?.headshotRel}
					<img src={headshotUrl(player.headshotRel)} alt="{player.name} headshot" class="w-full h-full object-cover" />
				{:else}
					<span class="font-mono text-[10px] text-fg-faint text-center px-1">{player ? 'no headshot' : 'pick a player'}</span>
				{/if}
			</div>
			<div class="space-y-2">
				<div class="flex flex-wrap items-end gap-2">
					<label class="{lbl} flex-1 min-w-48">
						Player
						<select class={field} value={treatment.playerSlug ?? ''} onchange={(e) => setPlayer((e.currentTarget as HTMLSelectElement).value)}>
							<option value="">Choose a player…</option>
							{#each leagues as lg (lg)}
								<optgroup label={lg}>
									{#each players.filter((p) => p.leagueSlug === lg) as p (p.slug + lg)}
										<option value={p.slug}>{p.name}{p.missing ? ' · no headshot' : p.lowRes ? ' · low-res' : ''}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
					</label>
					{#if player}
						<label
							class="inline-flex items-center justify-center rounded-md border border-border text-fg-muted font-mono text-[11px] uppercase tracking-wider px-3 py-2 hover:text-fg hover:bg-surface transition-colors cursor-pointer focus-within:outline focus-within:outline-1 focus-within:outline-accent"
						>
							{uploading ? 'Uploading…' : player.missing ? 'Upload headshot' : 'Replace headshot'}
							<input
								type="file"
								accept="image/*"
								class="sr-only"
								disabled={uploading}
								onchange={(e) => {
									const input = e.currentTarget as HTMLInputElement;
									const f = input.files?.[0];
									if (f) onupload(player.slug, f);
									input.value = '';
								}}
							/>
						</label>
					{/if}
				</div>
				{#if player?.missing}
					<p class="text-xs text-ember">No headshot on file for {player.name}. Upload one before generating.</p>
				{:else if player?.lowRes}
					<p class="text-xs text-warn">Headshot is under 256 px, so likeness will suffer. Upload a sharper one if you have it.</p>
				{/if}
			</div>
		</div>
		<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			<label class={lbl}>Age<input class={field} placeholder="as on cover" bind:value={treatment.age} onchange={onchange} /></label>
			<label class={lbl}>Gender<input class={field} placeholder="as player" bind:value={treatment.gender} onchange={onchange} /></label>
			<label class={lbl}>Clothing<input class={field} placeholder={subject.clothing || 'keep cover clothing'} bind:value={treatment.clothing} onchange={onchange} /></label>
			<label class={lbl}>Pose / gaze<input class={field} placeholder={[subject.pose, subject.gaze].filter(Boolean).join(' · ') || 'keep'} bind:value={treatment.poseGaze} onchange={onchange} /></label>
			<label class={lbl}>Style match<input class={field} placeholder="match cover rendering" bind:value={treatment.styleMatch} onchange={onchange} /></label>
			<label class={lbl}>Notes<input class={field} placeholder="anything else" bind:value={treatment.notes} onchange={onchange} /></label>
		</div>
		{#if player && onideas}
			<div class="flex flex-wrap items-center gap-1.5">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border border-border text-fg-muted font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 hover:text-fg hover:bg-surface transition-colors disabled:opacity-50"
					disabled={ideasLoading}
					onclick={loadIdeas}
				>
					{#if ideasLoading}<span class="inline-block h-2.5 w-2.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span>{/if}
					Ideas from {player.name}’s profile
				</button>
				{#each shownIdeas as idea, i (i)}
					{@const used = (treatment.notes ?? '').toLowerCase().includes(idea.toLowerCase())}
					<button
						type="button"
						class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {used
							? 'border-health/40 bg-health-bg text-health'
							: 'border-amber/40 bg-amber/10 text-amber hover:bg-amber/20'}"
						title={used ? 'Already in notes' : 'Add to notes'}
						aria-pressed={used}
						onclick={() => useIdea(idea)}>{used ? '✓ ' : '+ '}{idea}</button
					>
				{/each}
				{#if ideasError}<span class="text-xs text-fg-dim">{ideasError}</span>{/if}
			</div>
		{/if}
	{/if}

	<details bind:open={detailsOpen} class="group">
		<summary class="cursor-pointer select-none font-mono text-[10px] uppercase tracking-wider text-fg-faint hover:text-fg-dim">
			What the reader saw
		</summary>
		<div class="mt-2 grid gap-2 sm:grid-cols-2">
			<label class={lbl}>Position<input class={field} bind:value={subject.position} onchange={onchange} /></label>
			<label class={lbl}>Pose<input class={field} bind:value={subject.pose} onchange={onchange} /></label>
			<label class={lbl}>Gaze<input class={field} bind:value={subject.gaze} onchange={onchange} /></label>
			<label class={lbl}>Clothing<input class={field} bind:value={subject.clothing} onchange={onchange} /></label>
			<label class={lbl}>Expression<input class={field} bind:value={subject.expression} onchange={onchange} /></label>
			<label class={lbl}>Colour treatment<input class={field} bind:value={subject.color_treatment} onchange={onchange} /></label>
			<label class="{lbl} sm:col-span-2">Focus<input class={field} bind:value={subject.focus} onchange={onchange} /></label>
		</div>
	</details>
</article>
