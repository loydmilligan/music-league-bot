<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createPortalAdminApi,
		type PortalAdminConfig,
		type SectionCatalog,
		type SectionId,
	} from '../lib/portalAdminApi.js';
	import {
		SECTION_CARDS,
		FREQUENCY_LABELS,
		seedSelection,
		selectedIds,
		familyState,
		familyPayload,
		fmtLastRun,
		debounce,
	} from '../lib/portalAdminUi.js';

	interface Props { slug: string; }
	let { slug }: Props = $props();

	const api = createPortalAdminApi(slug);

	let cfg = $state<PortalAdminConfig | null>(null);
	let cat = $state<SectionCatalog | null>(null);
	let loadError = $state<string | null>(null);
	let status = $state('');
	let running = $state<Record<string, boolean>>({});

	let kpiSel = $state<Record<string, boolean>>({});
	let famSel = $state<Record<string, boolean>>({});
	let yearStr = $state('');
	let pulseText = $state('');
	let momentsText = $state('');

	async function load() {
		try {
			const [c, s] = await Promise.all([api.config(), api.sections()]);
			cfg = c;
			cat = s;
			kpiSel = seedSelection(s.kpis.map((k) => k.id));
			famSel = familyState(c.sections.family.players, s.members);
			yearStr = c.sections.yearbook.season === null ? '' : String(c.sections.yearbook.season);
			pulseText = c.sections.pulse.prompt ?? '';
			momentsText = c.sections.moments.prompt ?? '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load portal settings.';
		}
	}
	onMount(load);

	function commit(clone: PortalAdminConfig, msg = 'Saved.') {
		cfg = clone;
		status = msg;
		void api.saveConfig(clone).then(
			(saved) => { cfg = saved; status = 'Saved.'; },
			(e: unknown) => {
				status = e instanceof Error ? `Save failed: ${e.message}` : 'Save failed.';
				void load();
			}
		);
	}

	function edit(fn: (c: PortalAdminConfig) => void, msg = 'Saved.') {
		if (!cfg) return;
		const clone = structuredClone(cfg);
		fn(clone);
		commit(clone, msg);
	}

	function toggleSection(id: SectionId) {
		edit((c) => { c.sections[id].enabled = !c.sections[id].enabled; });
	}

	function setFreq(id: SectionId, freq: string) {
		edit((c) => { c.sections[id].frequency = freq as PortalAdminConfig['sections'][SectionId]['frequency']; });
	}

	function toggleCard(key: keyof PortalAdminConfig['sections']['thisWeek']['cards']) {
		edit((c) => { c.sections.thisWeek.cards[key] = !c.sections.thisWeek.cards[key]; });
	}

	function toggleLink(key: keyof PortalAdminConfig['sections']['thisWeek']['links']) {
		edit((c) => { c.sections.thisWeek.links[key] = !c.sections.thisWeek.links[key]; });
	}

	function toggleKpi(id: string) {
		kpiSel = { ...kpiSel, [id]: !kpiSel[id] };
		edit((c) => { c.sections.byNumbers.kpis = selectedIds(kpiSel); });
	}

	function toggleMember(id: string) {
		famSel = { ...famSel, [id]: !famSel[id] };
		edit((c) => { c.sections.family.players = familyPayload(famSel); });
	}

	function setAllMembers(on: boolean) {
		if (!cat) return;
		const next: Record<string, boolean> = {};
		for (const m of cat.members) next[m.id] = on;
		famSel = next;
		edit((c) => { c.sections.family.players = familyPayload(next); });
	}

	function setSeason(v: string) {
		yearStr = v;
		edit((c) => { c.sections.yearbook.season = v === '' ? null : Number(v); });
	}

	const savePrompt = debounce(700, (id: 'pulse' | 'moments', text: string) => {
		edit((c) => { c.sections[id].prompt = text || null; });
	});

	function resetPrompt(id: 'pulse' | 'moments') {
		if (id === 'pulse') pulseText = '';
		else momentsText = '';
		edit((c) => { c.sections[id].prompt = null; }, 'Reset to default.');
	}

	async function refreshSections() {
		try { cat = await api.sections(); } catch { /* keep stale run state */ }
	}

	async function runNow(id: SectionId) {
		status = '';
		try {
			running = { ...running, [id]: true };
			const { jobId } = await api.run(id);
			pollRun(id, jobId);
		} catch (e) {
			running = { ...running, [id]: false };
			status = e instanceof Error ? `Run failed: ${e.message}` : 'Run failed.';
		}
	}

	async function pollRun(id: SectionId, jobId: string) {
		try {
			const res = await api.runStatus(jobId);
			if (res.status === 'done' || res.status === 'failed') {
				running = { ...running, [id]: false };
				status = res.status === 'done' ? 'Updated.' : `Failed: ${res.error ?? 'unknown error'}`;
				void refreshSections();
				return;
			}
			setTimeout(() => pollRun(id, jobId), 1500);
		} catch {
			running = { ...running, [id]: false };
		}
	}
</script>

<section class="bs-sec">
	<div class="bs-eyebrow">Portal display</div>
	<h2 class="bs-sec-title">Home sections</h2>
	<p class="bs-sec-sub">What the players see on Home. Every change saves to the published portal immediately.</p>

	{#if loadError}
		<p class="err">{loadError}</p>
	{:else if !cfg || !cat}
		<p class="bs-sec-sub">Loading…</p>
	{:else}
		{#each SECTION_CARDS as card}
			<div class="bs-ps-card">
				<div class="bs-ps-head">
					<label class="bs-ps-toggle">
						<input type="checkbox" checked={cfg.sections[card.id].enabled}
							onchange={() => toggleSection(card.id)} />
						<span>{card.label}</span>
					</label>
					<div class="bs-ps-meta">
						<select class="bs-ps-freq" value={cfg.sections[card.id].frequency}
							onchange={(e) => setFreq(card.id, (e.currentTarget as HTMLSelectElement).value)}>
							{#each Object.entries(FREQUENCY_LABELS) as [v, l]}
								<option value={v}>{l}</option>
							{/each}
						</select>
						<span class="bs-ps-last">{fmtLastRun(cat.runState[card.id])}</span>
						{#if cat.nextDue[card.id]}<span class="bs-ps-due">due {cat.nextDue[card.id]}</span>{/if}
						<button class="bs-share-btn" onclick={() => runNow(card.id)}
							disabled={running[card.id]}>
							{running[card.id] ? 'Running…' : 'Run now'}
						</button>
					</div>
				</div>
				<p class="bs-ps-blurb">{card.blurb}</p>

				{#if card.id === 'thisWeek'}
					<div class="bs-ps-editor">
						<div class="bs-ps-sub">Home cards</div>
						<div class="bs-pills">
							{#each Object.entries(cfg.sections.thisWeek.cards) as [k, v]}
								<button class="bs-pill{!v ? ' bs-pill--off' : ''}"
									onclick={() => toggleCard(k as keyof PortalAdminConfig['sections']['thisWeek']['cards'])}>
									{k}
								</button>
							{/each}
						</div>
						<div class="bs-ps-sub">Round links</div>
						<div class="bs-pills">
							{#each Object.entries(cfg.sections.thisWeek.links) as [k, v]}
								<button class="bs-pill{!v ? ' bs-pill--off' : ''}"
									onclick={() => toggleLink(k as keyof PortalAdminConfig['sections']['thisWeek']['links'])}>
									{k}
								</button>
							{/each}
						</div>
					</div>
				{:else if card.id === 'byNumbers'}
					<div class="bs-ps-editor">
						<div class="bs-ps-sub">KPI pills</div>
						<div class="bs-pills">
							{#each cat.kpis as k}
								<button class="bs-pill{!kpiSel[k.id] ? ' bs-pill--off' : ''}"
									onclick={() => toggleKpi(k.id)}>{k.label}</button>
							{/each}
						</div>
					</div>
				{:else if card.id === 'family'}
					<div class="bs-ps-editor">
						<div class="bs-ps-sub">Show on Home — <b>{Object.values(famSel).filter(Boolean).length} of {cat.members.length}</b></div>
						<div class="bs-pills">
							<button class="bs-pill" onclick={() => setAllMembers(true)}>All</button>
							<button class="bs-pill" onclick={() => setAllMembers(false)}>None</button>
							{#each cat.members as m}
								<button class="bs-pill{!famSel[m.id] ? ' bs-pill--off' : ''}"
									onclick={() => toggleMember(m.id)}>{m.name}</button>
							{/each}
						</div>
					</div>
				{:else if card.id === 'yearbook'}
					<div class="bs-ps-editor">
						<label class="field">Season
							<select value={yearStr} onchange={(e) => setSeason((e.currentTarget as HTMLSelectElement).value)}>
								<option value="">Current season</option>
								{#each cat.seasons as s}
									<option value={s}>Season {s}</option>
								{/each}
							</select>
						</label>
					</div>
				{:else if card.id === 'pulse' || card.id === 'moments'}
					<div class="bs-ps-editor">
						<label class="field">Prompt
							<textarea rows="2" placeholder="Built-in prompt"
								value={card.id === 'pulse' ? pulseText : momentsText}
								oninput={(e) => {
									const t = (e.currentTarget as HTMLTextAreaElement).value;
									if (card.id === 'pulse') pulseText = t; else momentsText = t;
									savePrompt(card.id as 'pulse' | 'moments', t);
								}}></textarea>
						</label>
						<button class="bs-share-btn" onclick={() => resetPrompt(card.id as 'pulse' | 'moments')}>Reset to default</button>
					</div>
				{/if}
			</div>
		{/each}
		{#if status}<p class="bs-sec-sub">{status}</p>{/if}
	{/if}
</section>

<style>
	.bs-ps-card { border: 1px solid var(--line); border-radius: var(--r-3); background: var(--ink-2); padding: 14px; margin: 12px 0; }
	.bs-ps-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
	.bs-ps-toggle { display: flex; align-items: center; gap: 8px; font-weight: 700; }
	.bs-ps-toggle input { accent-color: var(--mash-pulp); }
	.bs-ps-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.bs-ps-last { font-size: 12px; color: var(--fg-quiet); }
	.bs-ps-due { font-size: 12px; color: var(--acc-sky, var(--fg-quiet)); }
	.bs-ps-blurb { color: var(--fg-quiet); font-size: 13px; margin: 8px 0 0; }
	.bs-ps-editor { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
	.bs-ps-sub { font-size: 12px; color: var(--fg-quiet); text-transform: uppercase; letter-spacing: 0.5px; }
	.bs-pills { display: flex; flex-wrap: wrap; gap: 6px; }
	.bs-pill { padding: 5px 10px; border-radius: var(--r-full); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); font-weight: 600; cursor: pointer; }
	.bs-pill--off { opacity: 0.45; text-decoration: line-through; }
	.bs-ps-freq { padding: 6px 8px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); font-size: 12px; }
	.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; margin: 6px 0; }
	.field select, .field textarea { padding: 8px 10px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); font-family: inherit; }
	.err { color: var(--ember); }
</style>