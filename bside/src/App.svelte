<script lang="ts">
	import { onMount } from 'svelte';
	import type { ReadModel, SharePayload, Nav } from './lib/types.js';
	import ShareOverlay from './lib/atoms/ShareOverlay.svelte';
	import HomeScreen from './routes/HomeScreen.svelte';
	import ProfileScreen from './routes/ProfileScreen.svelte';
	import ArchiveScreen from './routes/ArchiveScreen.svelte';

	// The per-slug index.html sets data-league-slug on <body>.
	const slug = (document.body as HTMLElement & { dataset: DOMStringMap }).dataset.leagueSlug ?? '';

	type Route =
		| { screen: 'home' }
		| { screen: 'profile'; memberId: string }
		| { screen: 'archive' };

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
		return { screen: 'home' };
	}

	let route = $state<Route>(parseRoute(window.location.pathname));
	let readModel = $state<ReadModel | null>(null);
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
		goProfile: (id) => push(`/${slug}/p/${id}`, { screen: 'profile', memberId: id }),
		openShare: (p) => { sharePayload = p; },
	};

	onMount(() => {
		const onPop = () => { route = parseRoute(window.location.pathname); };
		window.addEventListener('popstate', onPop);

		fetch(`/${slug}/read_model.json`)
			.then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ReadModel>; })
			.then((data) => { readModel = data; })
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
			<HomeScreen {readModel} {nav} />
		{:else if route.screen === 'profile'}
			<ProfileScreen {readModel} memberId={route.memberId} {nav} />
		{:else}
			<ArchiveScreen {readModel} {nav} />
		{/if}

		<ShareOverlay
			payload={sharePayload}
			leagueName={readModel.league.name}
			leagueSeason={readModel.league.season}
			onClose={() => { sharePayload = null; }}
		/>
	{/if}
</div>
