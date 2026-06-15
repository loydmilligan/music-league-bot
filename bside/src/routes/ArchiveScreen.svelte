<script lang="ts">
	import { icons } from '../lib/icons.js';
	import type { ReadModel, Nav } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; }
	let { readModel, nav }: Props = $props();

	const league = $derived(readModel.league);

	// Group rounds by season, newest first
	const grouped = $derived(() => {
		const bySeasons = new Map<number, typeof readModel.archive>();
		for (const entry of readModel.archive) {
			const list = bySeasons.get(entry.season) ?? [];
			list.push(entry);
			bySeasons.set(entry.season, list);
		}
		// Sort seasons descending
		return [...bySeasons.entries()].sort((a, b) => b[0] - a[0]);
	});

	const newestRound = $derived(readModel.archive[0]?.n ?? -1);
</script>

<div class="bs-pad">
	<!-- Top bar -->
	<div class="bs-topbar">
		<button class="bs-back" onclick={() => nav.goHome()}>
			{@html icons.chevL} League
		</button>
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>

	<!-- Hero -->
	<div class="bs-hero">
		<div class="bs-hero-eyebrow">{league.name}</div>
		<div class="bs-hero-name" style="font-size:38px;">Digest Archive</div>
		<div class="bs-sec-sub">{readModel.archive.length} rounds across {league.seasons} season{league.seasons !== 1 ? 's' : ''}</div>
	</div>

	<!-- Rounds grouped by season -->
	{#each grouped() as [season, entries]}
		<div class="bs-sec">
			<div class="bs-arch-group-h">Season {season}</div>
			<div class="bs-arch-list">
				{#each entries as entry}
					{@const isNew = entry.n === newestRound}
					{#if entry.digestUrl}
						<a class="bs-arch" href={entry.digestUrl} style:--hue={entry.hue}>
							<div class="bs-arch-n">{entry.n}</div>
							<div class="bs-arch-body">
								<div class="bs-arch-theme">{entry.theme}</div>
								<div class="bs-arch-win">
									{@html icons.trophy}
									<b>{entry.winnerSong}</b>
									<span>by {entry.winnerArtist}</span>
								</div>
							</div>
							<div class="bs-arch-meta">
								{#if isNew}<span class="bs-tag-new">New</span>{/if}
								<div class="bs-arch-date">{entry.date}</div>
								<div class="bs-arch-go">{@html icons.chevR}</div>
							</div>
						</a>
					{:else}
						<div class="bs-arch" style:--hue={entry.hue}>
							<div class="bs-arch-n">{entry.n}</div>
							<div class="bs-arch-body">
								<div class="bs-arch-theme">{entry.theme}</div>
								<div class="bs-arch-win">
									{@html icons.trophy}
									<b>{entry.winnerSong}</b>
									<span>by {entry.winnerArtist}</span>
								</div>
							</div>
							<div class="bs-arch-meta">
								{#if isNew}<span class="bs-tag-new">New</span>{/if}
								<div class="bs-arch-date">{entry.date}</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/each}

	<!-- Footer -->
	<div class="bs-footer">
		<div class="bs-mark bs-mark--sm">the b/side</div>
		<div class="bs-footer-note">No login required. No rankings. Just music.</div>
	</div>
</div>
