<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import PortalAdminPanel from './PortalAdminPanel.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import { SurveyApiError } from '../lib/surveyApi.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';

	interface Props { nav: Nav; portal: PortalJson | null; slug: string; }
	let { nav, portal, slug }: Props = $props();
	const session = getPortalSession();

	let isAdmin = $state(false);
	let tab = $state<'access' | 'bside' | 'planner'>('access');
	let stepped = $state(false);
	let code = $state('');
	let title = $state('');
	let body = $state('');
	let names = $state('');
	let requests = $state<{ id: string; playerName: string; status: string; code: string | null }[]>([]);
	let status = $state('');
	let error = $state<string | null>(null);
	let news = $state<{ id: string; title: string }[]>([]);

	async function refreshAdmin() {
		if (!session.api) return;
		const a = await session.api.adminSession();
		isAdmin = a.admin === true;
		stepped = a.steppedUp === true;
		if (!stepped) return;
		const [sw, roles, n] = await Promise.all([
			session.api.switchRequests(),
			session.api.roles(),
			session.api.news(),
		]);
		requests = sw.requests;
		names = roles.names.join(', ');
		news = n.items.map((i) => ({ id: i.id, title: i.title }));
	}

	$effect(() => { void refreshAdmin(); });

	async function stepUp() {
		if (!session.api) return;
		status = '';
		error = null;
		try {
			const r = await session.api.stepUp();
			status = r.devCode
				? `Dev code ${r.devCode}`
				: (r.reason ?? (r.sent.length ? `Code sent via ${r.sent.join(', ')}.` : 'Request a channel in Settings, then send the code.'));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not send a code.';
		}
	}

	async function verify() {
		if (!session.api) return;
		status = '';
		error = null;
		try {
			await session.api.verifyStepUp(code.trim());
			code = '';
			await session.refresh();
			await refreshAdmin();
		} catch (e) {
			error = e instanceof SurveyApiError ? e.message : (e instanceof Error ? e.message : 'Wrong or expired code.');
		}
	}

	async function act(id: string, action: 'activate' | 'deny' | 'send') {
		if (!session.api) return;
		const r = await session.api.actSwitch(id, action);
		status = r.reason ?? `${action} ok`;
		await refreshAdmin();
	}

	async function publishNews() {
		if (!session.api) return;
		await session.api.postNews({ title, body });
		title = ''; body = '';
		await refreshAdmin();
	}

	async function saveRoles() {
		if (!session.api) return;
		await session.api.saveRoles(names.split(',').map((n) => n.trim()).filter(Boolean));
		status = 'Roles saved.';
	}
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="admin" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<div class="bs-hero-eyebrow">Co-admins have full parity</div>
		<h1 class="bs-hero-name">Admin</h1>
	</header>

	{#if !isAdmin}
		<p class="bs-sec-sub">This page is for league admins. Sign in as an admin, then enter a one-time code.</p>
	{:else if !stepped}
		<p class="bs-sec-sub">Admin tools need a one-time code every session. Send it to ntfy or WhatsApp (when those are on in Settings), then enter it here. Nothing admin-side loads until the code checks out.</p>
		<button class="bs-share-btn" onclick={stepUp}>Send OTP</button>
		<label class="field">OTP <input bind:value={code} maxlength="6" inputmode="numeric" placeholder="000000" autocomplete="one-time-code" /></label>
		<button class="bs-share-btn" onclick={verify} disabled={code.trim().length !== 6}>Verify OTP</button>
	{:else}
		<div class="bs-tabs">
			<button class="bs-tab{tab === 'access' ? ' bs-tab--on' : ''}" onclick={() => (tab = 'access')}>Access</button>
			<button class="bs-tab{tab === 'bside' ? ' bs-tab--on' : ''}" onclick={() => (tab = 'bside')}>B-side</button>
			<button class="bs-tab{tab === 'planner' ? ' bs-tab--on' : ''}" onclick={() => (tab = 'planner')}>Season planner</button>
		</div>
		{#if tab === 'access'}
		<section class="bs-sec">
			<div class="bs-eyebrow">Name switches</div>
			<h2 class="bs-sec-title">Activate / Deny / Send</h2>
			{#each requests as req}
				<div class="card">
					<b>{req.playerName}</b> · {req.status}
					{#if req.code}<code>{req.code}</code>{/if}
					<div class="row">
						<button onclick={() => act(req.id, 'activate')}>Activate</button>
						<button onclick={() => act(req.id, 'send')}>Send via WhatsApp</button>
						<button onclick={() => act(req.id, 'deny')}>Deny</button>
					</div>
				</div>
			{:else}
				<p class="bs-sec-sub">No switch requests.</p>
			{/each}
		</section>
		<section class="bs-sec">
			<div class="bs-eyebrow">Roles</div>
			<label class="field">Admins <input bind:value={names} /></label>
			<button class="bs-share-btn" onclick={saveRoles}>Save roles</button>
		</section>
		{:else if tab === 'bside'}
		<section class="bs-sec">
			<div class="bs-eyebrow">News</div>
			<h2 class="bs-sec-title">Post to Home</h2>
			<label class="field">Title <input bind:value={title} /></label>
			<label class="field">Body <textarea bind:value={body} rows="4"></textarea></label>
			<button class="bs-share-btn" onclick={publishNews}>Publish</button>
			{#each news as item}
				<div class="card">{item.title}</div>
			{/each}
		</section>
		<PortalAdminPanel {slug} />
		{:else}
		<section class="bs-sec">
			<div class="bs-eyebrow">Season planner</div>
			<h2 class="bs-sec-title">Coming next</h2>
			<p class="bs-sec-sub">Automated round-derived season tasks land in the next slice.</p>
		</section>
		{/if}
	{/if}
	{#if error}<p class="err">{error}</p>{/if}
	{#if status}<p class="bs-sec-sub">{status}</p>{/if}
</div>

<style>
	.bs-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 18px; }
	.bs-tab { padding: 8px 14px; border-radius: var(--r-full); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg-quiet); font-weight: 700; cursor: pointer; }
	.bs-tab--on { background: var(--mash-pulp); border-color: var(--mash-pulp); color: #fff; }
	.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; margin: 10px 0; }
	.field input, .field textarea { padding: 10px 12px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); }
	.card { padding: 12px; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--ink-2); margin: 8px 0; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
	.row button { padding: 6px 10px; border-radius: var(--r-full); border: 0; background: var(--mash-pulp); color: #fff; font-weight: 700; cursor: pointer; }
	.err { color: var(--ember); }
	.bs-share-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
