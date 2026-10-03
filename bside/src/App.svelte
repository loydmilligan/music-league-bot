<script lang="ts">
	import { onMount } from 'svelte';
	import type { ReadModel, SharePayload, Nav } from './lib/types.js';
	import ShareOverlay from './lib/atoms/ShareOverlay.svelte';
	import HomeScreen from './routes/HomeScreen.svelte';
	import ProfileScreen from './routes/ProfileScreen.svelte';
	import ArchiveScreen from './routes/ArchiveScreen.svelte';
	import SeasonScreen from './routes/SeasonScreen.svelte';
	import { loadPortal, type PortalJson } from './lib/portal.js';

	// The per-slug index.html sets data-league-slug on <body>.
	const slug = (document.body as HTMLElement & { dataset: DOMStringMap }).dataset.leagueSlug ?? '';

	type Route =
		| { screen: 'home' }
		| { screen: 'profile'; memberId: string }
		| { screen: 'archive' }
		| { screen: 'season' };

	function parseRoute(pathname: string): Route {
		// Strip slug prefix if present (prod: /{slug}/p/{id}, dev: /p/{id})
		const rest = pathname.startsWith(`/${slug}`)
			? pathname.slice(`/${slug}`.length) || '/'
			: pathname;
		const clean = rest || '/';
		if (clean.startsWith('/p/')) {
			return { screen: 'profile', memberId: clean.slice(3).split('/')[0] || '' };
		}
		if (clean === '/archive') return { screen: 'archive' };
		if (clean === '/season') return { screen: 'season' };
		return { screen: 'home' };
	}

	let route = $state<Route>(parseRoute(window.location.pathname));
	let readModel = $state<ReadModel | null>(null);
	let portal = $state<PortalJson | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let sharePayload = $state<SharePayload | null>(null);

	function push(path: string, r: Route) {
		history.pushState(null, '', path);
		route = r;
		window.scrollTo(0, 0);
	}

	const nav: Nav = {
		goHome:    () => push(`/${slug}`, { screen: 'home' }),
		goArchive: () => push(`/${slug}/archive`, { screen: 'archive' }),
		goSeason:  () => push(`/${slug}/season`, { screen: 'season' }),
		goProfile: (id) => push(`/${slug}/p/${id}`, { screen: 'profile', memberId: id }),
		openShare: (p) => { sharePayload = p; },
	};

	onMount(() => {
		const onPop = () => { route = parseRoute(window.location.pathname); };
		window.addEventListener('popstate', onPop);

		const readModelRequest = fetch(`/${slug}/read_model.json`)
			.then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ReadModel>; });

		Promise.all([readModelRequest, loadPortal(slug)])
			.then(([data, portalData]) => { readModel = data; portal = portalData; })
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
		{:else}
			<ArchiveScreen {readModel} {nav} {portal} />
		{/if}

		<ShareOverlay
			payload={sharePayload}
			leagueName={readModel.league.name}
			leagueSeason={readModel.league.season}
			onClose={() => { sharePayload = null; }}
		/>
	{/if}
</div>
