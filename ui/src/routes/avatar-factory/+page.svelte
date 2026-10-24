<script lang="ts">
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';

	type Candidate = {
		id: string;
		themeSlug: string;
		letter: string;
		relPath: string;
		label: string;
		rating: number | null;
		ratingComment?: string;
		status: 'candidate' | 'approved' | 'rejected';
		source: 'generated' | 'imported';
		createdAt: string;
		costUsd?: number;
		costEstimated?: boolean;
		pricingBasis?: string;
		promptTruncated?: boolean;
		provider?: string;
		model?: string;
		usedNotes?: string;
	};
	type Member = {
		slug: string;
		name: string;
		playerId: number | null;
		height: string;
		notes: string;
		photoRel: string | null;
		candidates: Candidate[];
	};
	type GroupShot = {
		id: string;
		themeSlug: string;
		relPath: string;
		label: string;
		status: string;
		source: string;
		costUsd?: number;
		costEstimated?: boolean;
		pricingBasis?: string;
		promptTruncated?: boolean;
		provider?: string;
		model?: string;
	};
	type CostBucket = { actualUsd: number; estimatedUsd: number; importedCount: number; generatedCount: number };
	type Theme = { slug: string; name: string; prompt: string; attachInspiration: boolean };
	type ProviderStatus = {
		id: string;
		label: string;
		model: string;
		estimatedCostUsd?: number;
		available: boolean;
		needsKey: boolean;
		enabled: boolean;
		isDefault: boolean;
		disabledReason?: string | null;
	};
	type FactoryPayload = {
		leagues: { slug: string; name: string }[];
		themes: Theme[];
		league: { slug: string; name: string; members: Member[]; groupShots: GroupShot[] };
		costUsd: number;
		attemptCount: number;
		sourcesConfigured: boolean;
		providers?: ProviderStatus[];
		defaultProvider?: string;
		generationPaused?: boolean;
		pausedMessage?: string | null;
		costTotals?: { overall: CostBucket; league: CostBucket; themes: Record<string, CostBucket> };
	};

	let { data } = $props();
	let payload = $state<FactoryPayload | null>((data as { initial?: FactoryPayload | null }).initial ?? null);
	let errorMsg = $state((data as { error?: string }).error ?? '');
	let busy = $state('');
	let leagueSlug = $state(payload?.league.slug ?? 'boarz-ii-men');
	let themeSlug = $state(
		payload?.themes.some((t) => t.slug === 'south-park')
			? 'south-park'
			: (payload?.themes[0]?.slug ?? 'south-park'),
	);
	let memberSlug = $state(payload?.league.members[0]?.slug ?? '');
	let tweakNote = $state('');
	let pickerOpen = $state(false);
	let pickerPath = $state('boarz-players');
	let pickerEntries = $state<{ name: string; rel: string; type: 'file' | 'dir'; size: number }[]>([]);
	let newThemeName = $state('');
	let newThemePrompt = $state('');
	let providerId = $state('openrouter');
	let confirmJob = $state<null | {
		title: string;
		images: number;
		estimatedCostUsd: number;
		provider: string;
		model: string;
		body: Record<string, unknown>;
	}>(null);

	const members = $derived(payload?.league.members ?? []);
	const themes = $derived(payload?.themes ?? []);
	const member = $derived(members.find((m) => m.slug === memberSlug) ?? members[0]);
	const theme = $derived(themes.find((t) => t.slug === themeSlug) ?? themes[0]);
	const themeCandidates = $derived(
		(member?.candidates ?? []).filter((c) => c.themeSlug === themeSlug).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
	);
	const approvedCount = $derived(
		members.filter((m) => m.candidates.some((c) => c.themeSlug === themeSlug && c.status === 'approved')).length,
	);
	const groupUnlocked = $derived(members.length > 0 && approvedCount === members.length);
	const groupShots = $derived((payload?.league.groupShots ?? []).filter((g) => g.themeSlug === themeSlug));
	const providers = $derived(payload?.providers ?? []);
	const generationPaused = $derived(!!payload?.generationPaused);
	const selectedProvider = $derived(providers.find((p) => p.id === providerId) ?? providers.find((p) => p.isDefault));
	const genBlocked = $derived(
		generationPaused || !!busy || !selectedProvider?.enabled || selectedProvider?.available === false,
	);
	const themeCosts = $derived(payload?.costTotals?.themes?.[themeSlug]);

	function fmtBucket(b?: CostBucket) {
		if (!b) return '$0';
		const bits: string[] = [];
		if (b.actualUsd) bits.push(`$${b.actualUsd.toFixed(4)} actual`);
		if (b.estimatedUsd) bits.push(`$${b.estimatedUsd.toFixed(4)} estimate`);
		if (!bits.length) bits.push('$0');
		return bits.join(' · ');
	}

	function costLine(c: {
		source?: string;
		provider?: string;
		model?: string;
		costUsd?: number;
		costEstimated?: boolean;
		pricingBasis?: string;
	}) {
		if (c.source === 'imported') return 'imported, $0';
		const head = [c.provider, c.model].filter(Boolean).join(' · ');
		if (c.costUsd == null) return head || '';
		const est = c.costEstimated ? (c.pricingBasis ? ` estimate · ${c.pricingBasis}` : ' estimate') : '';
		return `${head}${head ? ' · ' : ''}$${c.costUsd.toFixed(4)}${est}`;
	}

	function askConfirm(title: string, images: number, body: Record<string, unknown>) {
		if (genBlocked) return;
		const unit = selectedProvider?.estimatedCostUsd ?? 0.04;
		confirmJob = {
			title,
			images,
			estimatedCostUsd: unit * images,
			provider: selectedProvider?.label ?? selectedProvider?.id ?? '',
			model: selectedProvider?.model ?? '',
			body: { ...body, confirmed: true },
		};
	}

	async function runConfirmed() {
		const job = confirmJob;
		confirmJob = null;
		if (!job) return;
		await post(job.body);
	}

	function imgUrl(kind: 'images' | 'photos', rel: string | null | undefined) {
		if (!rel) return '';
		return `/api/avatar-factory/media/${kind}/${rel.split('/').map(encodeURIComponent).join('/')}`;
	}

	async function post(body: Record<string, unknown>) {
		busy = String(body.action ?? 'working');
		errorMsg = '';
		try {
			const r = await fetch('/api/avatar-factory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error((j as { message?: string }).message || (j as { error?: string }).error || r.statusText);
			await reload();
			return j;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'request failed';
		} finally {
			busy = '';
		}
	}

	async function reload() {
		const r = await fetch(`/api/avatar-factory?league=${encodeURIComponent(leagueSlug)}`);
		if (!r.ok) throw new Error('reload failed');
		payload = (await r.json()) as FactoryPayload;
		if (memberSlug && !payload.league.members.some((m) => m.slug === memberSlug)) {
			memberSlug = payload.league.members[0]?.slug ?? '';
		}
	}

	async function onLeague(slug: string) {
		leagueSlug = slug;
		await reload();
		memberSlug = payload?.league.members[0]?.slug ?? '';
	}

	async function openPicker() {
		pickerOpen = true;
		await loadPicker(pickerPath);
	}

	async function loadPicker(path: string) {
		pickerPath = path;
		const r = await fetch(`/api/avatar-factory/sources?path=${encodeURIComponent(path)}`);
		const j = await r.json();
		if (!r.ok) {
			errorMsg = j.message || 'folder list failed';
			return;
		}
		pickerEntries = j.entries;
	}

	async function pickFile(rel: string) {
		await post({ action: 'pick-photo', leagueSlug, memberSlug: member?.slug, sourceRel: rel });
		pickerOpen = false;
	}

	async function onUpload(ev: Event) {
		const input = ev.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !member) return;
		const fd = new FormData();
		fd.set('leagueSlug', leagueSlug);
		fd.set('memberSlug', member.slug);
		fd.set('file', file);
		busy = 'upload';
		try {
			const r = await fetch('/api/avatar-factory', { method: 'POST', body: fd });
			if (!r.ok) throw new Error('upload failed');
			await reload();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'upload failed';
		} finally {
			busy = '';
			input.value = '';
		}
	}

	const btn =
		'inline-flex items-center justify-center rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors disabled:opacity-50';
	const btnGhost =
		'inline-flex items-center justify-center rounded-md border border-border text-fg-muted font-mono text-xs uppercase tracking-wider px-3 py-2 hover:text-fg hover:bg-surface transition-colors disabled:opacity-50';
</script>

<svelte:head>
	<title>Avatar Factory</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<SectionLabel>Admin</SectionLabel>
			<h1 class="font-display text-3xl mt-1">Avatar Factory</h1>
			<p class="text-sm text-fg-muted mt-1">
				OpenRouter / Runway / fal.ai · confirm before each run · Grok disabled
			</p>
		</div>
		<div class="flex flex-col items-end gap-1 text-right">
			<StatusChip label={`${payload?.attemptCount ?? 0} attempts`} tone="muted" />
			<span class="font-mono text-[10px] text-fg-dim">overall {fmtBucket(payload?.costTotals?.overall)}</span>
			<span class="font-mono text-[10px] text-fg-dim">league {fmtBucket(payload?.costTotals?.league)}</span>
			<span class="font-mono text-[10px] text-fg-dim">{theme?.name ?? 'theme'} {fmtBucket(themeCosts)}</span>
		</div>
	</header>

	{#if generationPaused}
		<div class="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
			{payload?.pausedMessage || 'OpenRouter image gen paused'}. Browsing, rating, approve, and Rescan still work.
		</div>
	{/if}
	{#if errorMsg}
		<div class="rounded-md border border-ember bg-ember-bg px-3 py-2 text-sm">{errorMsg}</div>
	{/if}

	<div class="flex flex-wrap gap-3 items-end">
		<label class="flex flex-col gap-1 text-xs font-mono uppercase tracking-wider text-fg-faint">
			League
			<select
				class="bg-surface border border-border rounded-md px-2 py-2 text-sm text-fg min-w-48"
				value={leagueSlug}
				onchange={(e) => onLeague((e.currentTarget as HTMLSelectElement).value)}
			>
				{#each payload?.leagues ?? [] as l}
					<option value={l.slug}>{l.name}</option>
				{/each}
			</select>
		</label>
		<div class="flex gap-2 flex-wrap">
			{#each themes as t}
				<button
					type="button"
					data-theme={t.slug}
					class={themeSlug === t.slug ? btn : btnGhost}
					onclick={() => (themeSlug = t.slug)}>{t.name}</button
				>
			{/each}
		</div>
		<label class="flex flex-col gap-1 text-xs font-mono uppercase tracking-wider text-fg-faint">
			Provider
			<select
				class="bg-surface border border-border rounded-md px-2 py-2 text-sm text-fg min-w-56"
				data-provider="picker"
				value={providerId}
				onchange={(e) => (providerId = (e.currentTarget as HTMLSelectElement).value)}
			>
				{#each providers as p}
					<option value={p.id} disabled={!p.enabled}>
						{p.label}{p.isDefault ? ' · default' : ''}{p.disabledReason ? ` · ${p.disabledReason}` : ''}
					</option>
				{/each}
			</select>
		</label>
		<button type="button" class={btnGhost} disabled={!!busy} onclick={() => post({ action: 'rescan' })}>
			{busy === 'rescan' ? 'Scanning…' : 'Rescan sources'}
		</button>
	</div>

	<section class="grid md:grid-cols-[220px_1fr] gap-6">
		<aside class="space-y-2">
			<SectionLabel>Members ({members.length})</SectionLabel>
			<ul class="flex flex-col gap-1">
				{#each members as m}
					{@const approved = m.candidates.some((c) => c.themeSlug === themeSlug && c.status === 'approved')}
					<li>
						<button
							type="button"
							data-member={m.slug}
							class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-sm transition-colors"
							class:bg-accent-bg={member?.slug === m.slug}
							class:text-accent={member?.slug === m.slug}
							class:hover:bg-surface={member?.slug !== m.slug}
							onclick={() => (memberSlug = m.slug)}
						>
							{#if m.photoRel}
								<img src={imgUrl('photos', m.photoRel)} alt="" class="w-8 h-8 rounded-sm object-cover" />
							{:else}
								<span class="w-8 h-8 rounded-sm bg-surface block"></span>
							{/if}
							<span class="flex-1 min-w-0">
								<span class="block text-sm truncate">{m.name}</span>
								<span class="block font-mono text-[10px] text-fg-dim">{m.height}</span>
							</span>
							{#if approved}
								<span class="text-health text-xs">✓</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		{#if member && theme}
			<div class="space-y-5">
				<div class="flex flex-wrap items-start gap-4">
					{#if member.photoRel}
						<img src={imgUrl('photos', member.photoRel)} alt="{member.name} photo" class="w-28 h-28 rounded-md object-cover border border-border" />
					{/if}
					<div class="flex-1 min-w-0 space-y-2">
						<h2 class="font-display text-2xl">{member.name}</h2>
						<p class="font-mono text-xs text-fg-dim">{member.slug} · {member.height}</p>
						<textarea
							class="w-full bg-surface border border-border rounded-md p-2 text-sm min-h-20"
							value={member.notes}
							onchange={(e) =>
								post({
									action: 'notes',
									leagueSlug,
									memberSlug: member.slug,
									notes: (e.currentTarget as HTMLTextAreaElement).value,
								})}
						></textarea>
						<div class="flex flex-wrap gap-2">
							<label class={btnGhost}>
								Upload photo
								<input type="file" accept="image/*" class="hidden" onchange={onUpload} />
							</label>
							<button type="button" class={btnGhost} onclick={openPicker}>Pick from server folder</button>
							<button
								type="button"
								class={btn}
								disabled={genBlocked || !member.photoRel}
								onclick={() =>
									askConfirm('Generate A/B/C', 3, {
										action: 'generate',
										leagueSlug,
										themeSlug,
										memberSlug: member.slug,
										count: 3,
										provider: providerId,
									})}
							>
								{busy === 'generate' ? 'Generating…' : 'Generate A/B/C'}
							</button>
						</div>
					</div>
				</div>

				<SectionLabel>Candidates · {theme.name}</SectionLabel>
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each themeCandidates as c}
						<article
							class="bg-surface border rounded-md p-3 space-y-2"
							class:border-health={c.status === 'approved'}
							class:border-border={c.status !== 'approved'}
							class:opacity-60={c.status === 'rejected'}
						>
							<img src={imgUrl('images', c.relPath)} alt={c.label} class="w-full aspect-square object-cover rounded-sm" />
							<div class="flex items-center justify-between gap-2">
								<span class="font-mono text-xs">{c.letter} · {c.label}</span>
								{#if c.status === 'approved'}
									<StatusChip label="approved" tone="muted" />
								{/if}
							</div>
							<p class="font-mono text-[10px] text-fg-dim">{costLine(c)}</p>
							{#if c.promptTruncated}
								<p class="font-mono text-[10px] text-warn">prompt truncated to 1000 chars (Runway)</p>
							{/if}
							{#if c.usedNotes}
								<p class="text-[11px] text-fg-muted whitespace-pre-wrap">{c.usedNotes}</p>
							{/if}
							<div class="flex gap-1" aria-label="rating">
								{#each [1, 2, 3, 4, 5] as star}
									<button
										type="button"
										class="text-sm"
										class:text-warn={c.rating && star <= c.rating}
										class:text-fg-faint={!c.rating || star > c.rating}
										onclick={() =>
											post({
												action: 'rate',
												leagueSlug,
												memberSlug: member.slug,
												candidateId: c.id,
												rating: star,
												comment: c.ratingComment ?? '',
											})}
										>★</button
									>
								{/each}
							</div>
							<textarea
								class="w-full bg-bg border border-border rounded-sm p-1.5 text-xs min-h-12"
								placeholder="Comment (fed into later generate/tweak)"
								value={c.ratingComment ?? ''}
								onchange={(e) =>
									post({
										action: 'rate',
										leagueSlug,
										memberSlug: member.slug,
										candidateId: c.id,
										rating: c.rating ?? 0,
										comment: (e.currentTarget as HTMLTextAreaElement).value,
									})}
							></textarea>
							<div class="flex flex-wrap gap-1">
								<button
									type="button"
									class={btn}
									disabled={!!busy}
									onclick={() =>
										post({ action: 'approve', leagueSlug, memberSlug: member.slug, candidateId: c.id })}
									>Approve</button
								>
								<button
									type="button"
									class={btnGhost}
									onclick={() => post({ action: 'reject', leagueSlug, memberSlug: member.slug, candidateId: c.id })}
									>Reject</button
								>
							</div>
						</article>
					{:else}
						<p class="text-sm text-fg-dim italic">No candidates yet. Rescan sources or generate.</p>
					{/each}
				</div>

				<div class="flex flex-wrap gap-2 items-end">
					<label class="flex-1 flex flex-col gap-1 text-xs font-mono uppercase tracking-wider text-fg-faint">
						Tweak note
						<input
							class="bg-surface border border-border rounded-md px-2 py-2 text-sm text-fg"
							bind:value={tweakNote}
							placeholder="e.g. more hair on the sides"
						/>
					</label>
					<button
						type="button"
						class={btnGhost}
						disabled={genBlocked || !tweakNote.trim()}
						onclick={() =>
							askConfirm('Tweak (1 image)', 1, {
								action: 'tweak',
								leagueSlug,
								themeSlug,
								memberSlug: member.slug,
								tweakNote,
								provider: providerId,
							})}
						>Tweak (new version)</button
					>
				</div>
			</div>
		{/if}
	</section>

	<section class="space-y-3 border-t border-border-muted pt-6">
		<SectionLabel>Group shot · {theme?.name ?? ''}</SectionLabel>
		<p class="text-sm text-fg-muted">
			Approved {approvedCount}/{members.length}. Request group shot unlocks when every member has one approved avatar.
		</p>
		<button
			type="button"
			class={btn}
			disabled={!groupUnlocked || genBlocked}
			onclick={() =>
				askConfirm('Request group shot', 1, {
					action: 'group-shot',
					leagueSlug,
					themeSlug,
					provider: providerId,
				})}
		>
			{busy === 'group-shot' ? 'Requesting…' : 'Request group shot'}
		</button>
		<div class="grid sm:grid-cols-2 gap-4">
			{#each groupShots as g}
				<figure class="bg-surface border border-border rounded-md p-3">
					<img src={imgUrl('images', g.relPath)} alt={g.label} class="w-full rounded-sm" />
					<figcaption class="mt-2 font-mono text-xs text-fg-dim">{g.label} · {costLine(g)}</figcaption>
				</figure>
			{/each}
		</div>
	</section>

	<section class="space-y-2 border-t border-border-muted pt-6">
		<SectionLabel>New theme</SectionLabel>
		<div class="flex flex-wrap gap-2">
			<input class="bg-surface border border-border rounded-md px-2 py-2 text-sm" placeholder="Name" bind:value={newThemeName} />
			<input class="flex-1 bg-surface border border-border rounded-md px-2 py-2 text-sm" placeholder="Prompt" bind:value={newThemePrompt} />
			<button
				type="button"
				class={btnGhost}
				disabled={!newThemeName.trim() || !newThemePrompt.trim()}
				onclick={() =>
					post({ action: 'create-theme', name: newThemeName, slug: newThemeName, prompt: newThemePrompt })}
				>Add theme</button
			>
		</div>
	</section>
</div>

{#if confirmJob}
	<div class="fixed inset-0 bg-black/60 z-40 flex items-end md:items-center justify-center p-4">
		<div class="bg-bg-elevated border border-border rounded-md w-full max-w-md p-4 space-y-3">
			<h3 class="font-display text-xl">{confirmJob.title}</h3>
			<p class="text-sm">
				{confirmJob.provider} · {confirmJob.model} · {confirmJob.images} image{confirmJob.images === 1 ? '' : 's'}
			</p>
			<p class="font-mono text-sm">Estimated cost: ${confirmJob.estimatedCostUsd.toFixed(4)}</p>
			<p class="text-xs text-fg-dim">Cancel makes no request. Opening this dialog does not call any provider.</p>
			<div class="flex gap-2 justify-end">
				<button type="button" class={btnGhost} onclick={() => (confirmJob = null)}>Cancel</button>
				<button type="button" class={btn} onclick={runConfirmed}>Confirm</button>
			</div>
		</div>
	</div>
{/if}

{#if pickerOpen}
	<div class="fixed inset-0 bg-black/60 z-40 flex items-end md:items-center justify-center p-4">
		<div class="bg-bg-elevated border border-border rounded-md w-full max-w-lg max-h-[80vh] overflow-auto p-4 space-y-3">
			<div class="flex justify-between items-center">
				<h3 class="font-display text-xl">Server folder</h3>
				<button type="button" class={btnGhost} onclick={() => (pickerOpen = false)}>Close</button>
			</div>
			<p class="font-mono text-xs text-fg-dim">{pickerPath || '/'}</p>
			{#if pickerPath}
				<button
					type="button"
					class={btnGhost}
					onclick={() => loadPicker(pickerPath.split('/').slice(0, -1).join('/'))}>Up</button
				>
			{/if}
			<ul class="divide-y divide-border-muted">
				{#each pickerEntries as e}
					<li>
						{#if e.type === 'dir'}
							<button type="button" class="w-full text-left py-2 text-sm" onclick={() => loadPicker(e.rel)}
								>📁 {e.name}</button
							>
						{:else}
							<button type="button" class="w-full text-left py-2 text-sm flex items-center gap-2" onclick={() => pickFile(e.rel)}>
								<img src={`/api/avatar-factory/sources/file/${e.rel.split('/').map(encodeURIComponent).join('/')}`} alt="" class="w-8 h-8 object-cover rounded-sm" />
								<span>{e.name}</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}
