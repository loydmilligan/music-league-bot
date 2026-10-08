<script lang="ts">
	import { onMount } from 'svelte';
	import type { ReadModel, SharePayload } from './lib/types.js';
	import ShareOverlay from './lib/atoms/ShareOverlay.svelte';
	import HomeScreen from './routes/HomeScreen.svelte';
	import ProfileScreen from './routes/ProfileScreen.svelte';
	import ArchiveScreen from './routes/ArchiveScreen.svelte';
	import SeasonScreen from './routes/SeasonScreen.svelte';
	import LoginScreen from './routes/LoginScreen.svelte';
	import LogoutScreen from './routes/LogoutScreen.svelte';
	import SettingsScreen from './routes/SettingsScreen.svelte';
	import AdminScreen from './routes/AdminScreen.svelte';
	import SurveyScreen from './routes/SurveyScreen.svelte';
	import MyThemesScreen from './routes/MyThemesScreen.svelte';
	import { loadPortal, type PortalJson } from './lib/portal.js';
	import { parseRoute, navFor, type PortalRoute } from './lib/routes.js';
	import { createSurveyApi, type AuthMe, type SurveyApi } from './lib/surveyApi.js';
	import { setPortalSession, type PortalSession } from './lib/portalSession.js';

	const slug = (document.body as HTMLElement & { dataset: DOMStringMap }).dataset.leagueSlug ?? '';

	let route = $state<PortalRoute>(parseRoute(window.location.pathname, slug));
	let readModel = $state<ReadModel | null>(null);
	let portal = $state<PortalJson | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let sharePayload = $state<SharePayload | null>(null);

	const session = $state<PortalSession>({
		me: null,
		hub: null,
		admin: false,
		api: null,
		refresh: async () => {},
	});
	setPortalSession(session);

	function push(path: string, r: PortalRoute) {
		history.pushState(null, '', path);
		route = r;
		window.scrollTo(0, 0);
	}

	const nav = navFor(slug, push, (p) => { sharePayload = p; });

	async function refreshSession() {
		const api = session.api;
		if (!api) {
			session.me = null;
			session.hub = null;
			session.admin = false;
			return;
		}
		try {
			const me = await api.me();
			session.me = me;
			if (me.authenticated) {
				try { session.hub = await api.hub(); } catch { session.hub = null; }
				try {
					const a = await api.adminSession();
					session.admin = a.admin === true;
				} catch { session.admin = false; }
			} else {
				session.hub = null;
				session.admin = false;
			}
		} catch {
			session.me = { authenticated: false } satisfies AuthMe;
			session.hub = null;
			session.admin = false;
		}
	}
	session.refresh = refreshSession;

	const signedIn = $derived(session.me?.authenticated === true);
	const gated = $derived(
		route.screen === 'settings' || route.screen === 'admin' || route.screen === 'survey' || route.screen === 'mine'
	);

	onMount(() => {
		const onPop = () => { route = parseRoute(window.location.pathname, slug); };
		window.addEventListener('popstate', onPop);

		const readModelRequest = fetch(`/${slug}/read_model.json`)
			.then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ReadModel>; });

		Promise.all([readModelRequest, loadPortal(slug)])
			.then(async ([data, portalData]) => {
				readModel = data;
				portal = portalData;
				const apiBase = portalData?.survey?.apiBase;
				if (apiBase) {
					session.api = createSurveyApi(apiBase) as SurveyApi;
					await refreshSession();
				}
			})
			.catch((e: unknown) => { error = e instanceof Error ? e.message : 'Failed to load'; })
			.finally(() => { loading = false; });

		return () => window.removeEventListener('popstate', onPop);
	});
</script>

<div class="bs-app">
	{#if loading}
		<div class="bs-loading">Loading…</div>
	{:else if error || !readModel}
		<div class="bs-error">Could not load league data: {error ?? 'unknown error'}</div>
	{:else}
		{#if route.screen === 'home'}
			<HomeScreen {readModel} {nav} {portal} />
		{:else if route.screen === 'profile'}
			<ProfileScreen {readModel} memberId={route.memberId} {nav} {portal} />
		{:else if route.screen === 'season'}
			<SeasonScreen {readModel} {nav} {portal} />
		{:else if route.screen === 'archive'}
			<ArchiveScreen {readModel} {nav} {portal} />
		{:else if route.screen === 'logout'}
			<LogoutScreen {nav} {portal} />
		{:else if route.screen === 'login' || (gated && !signedIn)}
			<LoginScreen {nav} {portal} />
		{:else if route.screen === 'settings'}
			<SettingsScreen {nav} {portal} />
		{:else if route.screen === 'admin'}
			<AdminScreen {nav} {portal} slug={slug} />
		{:else if route.screen === 'survey'}
			<SurveyScreen {nav} {portal} />
		{:else if route.screen === 'mine'}
			<MyThemesScreen {nav} {portal} />
		{/if}

		<ShareOverlay
			payload={sharePayload}
			leagueName={readModel.league.name}
			leagueSeason={readModel.league.season}
			onClose={() => { sharePayload = null; }}
		/>
	{/if}
</div>
