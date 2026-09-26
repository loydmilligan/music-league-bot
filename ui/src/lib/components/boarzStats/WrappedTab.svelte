<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';

	let { snap }: { snap: Snapshot } = $props();

	const chat = snap.chat;
	const people = chat.people;
	const comps = snap.competitors;

	const last = snap.cumulative[snap.cumulative.length - 1] ?? [];
	const champion = comps[last.indexOf(Math.max(...last))];

	const topTalker = [...people].sort((a, b) => b.msgs - a.msgs)[0];
	const topRoast = [...people].sort((a, b) => b.mentionGiven - a.mentionGiven)[0];
	const mostRoasted = [...people].sort((a, b) => b.mentionReceived - a.mentionReceived)[0];
	const owl = [...people].sort(
		(a, b) => b.hourHist.slice(0, 5).reduce((x, y) => x + y, 0) - a.hourHist.slice(0, 5).reduce((x, y) => x + y, 0)
	)[0];
	const igniter = [...people].sort((a, b) => b.maxAfter60 - a.maxAfter60)[0];
	const starter = [...people].sort((a, b) => b.roundStarters + b.resultStarters - (a.roundStarters + a.resultStarters))[0];
	const scramble = [...people].sort((a, b) => b.scrambleMsgs - a.scrambleMsgs)[0];
	const selfPromo = chat.selfPromo[0];
	const topSong = snap.songs[0];
	const mostLovedArtist = snap.artists[0];

	const cards = [
		{ icon: '👑', title: 'League Champion', value: champion?.name, sub: `${Math.max(...last)} total points` },
		{ icon: '💬', title: 'Top Talker', value: topTalker?.display, sub: `${topTalker?.msgs} messages` },
		{ icon: '🧨', title: 'Burst Igniter', value: igniter?.display, sub: `${igniter?.maxAfter60} replies after one message` },
		{ icon: '🔥', title: 'Top Roaster', value: topRoast?.display, sub: `${topRoast?.mentionGiven} name-drops` },
		{ icon: '🪑', title: 'Most Roasted', value: mostRoasted?.display, sub: `${mostRoasted?.mentionReceived} mentions` },
		{ icon: '🦉', title: 'Night Owl', value: owl?.display, sub: `${owl?.hourHist.slice(0, 5).reduce((x, y) => x + y, 0)} msgs after midnight` },
		{ icon: '🚪', title: 'First In The Chat', value: starter?.display, sub: `${(starter?.roundStarters ?? 0) + (starter?.resultStarters ?? 0)} first replies` },
		{ icon: '⏰', title: 'Deadline Scrambler', value: scramble?.display, sub: `${scramble?.scrambleMsgs} msgs in final 24h windows` },
		{ icon: '📣', title: 'Self-Promo Champ', value: selfPromo?.key ?? 'Nobody', sub: `${selfPromo?.count ?? 0} own songs hyped` },
		{ icon: '🎵', title: 'Song of the Season', value: topSong?.title, sub: `${topSong?.totalPts} pts — ${topSong?.compName}` },
		{ icon: '🎤', title: 'Artist of the Season', value: mostLovedArtist?.artist, sub: `${mostLovedArtist?.subs} submissions, ${mostLovedArtist?.totalPts} pts` },
	];

	const quotes = chat.vibeHall.map((v) => ({ ...v }));
</script>

<div class="space-y-6">
	<section class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each cards as c (c.title)}
			<div class="rounded-2xl border border-border-muted bg-surface/50 p-4">
				<div class="text-2xl">{c.icon}</div>
				<div class="mt-1 text-xs tracking-wide text-fg-muted uppercase">{c.title}</div>
				<div class="mt-1 truncate text-lg font-bold" title={c.value ?? ''}>{c.value ?? '—'}</div>
				<div class="text-sm text-fg-muted">{c.sub}</div>
			</div>
		{/each}
	</section>

	{#if quotes.length}
		<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-1 text-lg font-semibold">🧨 Most Igniting Messages</h2>
			<p class="mb-4 text-sm text-fg-muted">The messages that set off the biggest storms.</p>
			<div class="space-y-3">
				{#each quotes as q (q.ts)}
					<div class="rounded-xl border border-border-muted p-3">
						<div class="flex justify-between text-xs text-fg-muted">
							<span class="font-semibold text-fg">{q.display}</span>
							<span>{q.after} messages followed within an hour · {new Date(q.ts).toLocaleString([], { month: 'short', day: 'numeric' })}</span>
						</div>
						<div class="mt-1">“{q.snippet}”</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">📖 The story of the season</h2>
		<p class="text-sm text-fg-muted">
			{snap.rounds.length} rounds, {snap.subs.length} songs, {snap.votes.length} votes, and
			{people.reduce((a, p) => a + p.msgs, 0)} chat messages between friends.
			{champion?.name} took the crown; {topTalker?.display} never stopped talking about it.
		</p>
	</section>
</div>
