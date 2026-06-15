<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import type { ReadModel, Nav } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; }
	let { readModel, nav }: Props = $props();

	const league = $derived(readModel.league);

	// Group rounds by season, newest first
	const grouped = $derived.by(() => {
		const bySeasons = new Map<number, typeof readModel.archive>();
		for (const entry of readModel.archive) {
			const list = bySeasons.get(entry.season) ?? [];
			list.push(entry);
			bySeasons.set(entry.season, list);
		}
		return [...bySeasons.entries()].sort((a, b) => b[0] - a[0]);
	});

	const newestRound = $derived(readModel.archive[0]?.n ?? -1);

	function submitter(id: string) {
		return readModel.members.find((m) => m.id === id) ?? null;
	}
</script>

<div class="bs-pad">
	<!-- Top bar -->
	<div class="bs-topbar">
		<button class="bs-back" onclick={() => nav.goHome()}>
			{@html icons.chevL} {league.name}
		</button>
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>

	<!-- Hero -->
	<header class="bs-hero" style="gap:8px;">
		<div class="bs-hero-eyebrow">The archive</div>
		<div class="bs-hero-name" style="font-size:38px;">Every round,<br/>re-readable.</div>
		<p class="bs-hero-tag">{readModel.archive.length} digests and counting — the full story of each round, kept forever.</p>
	</header>

	<!-- Rounds grouped by season, newest first -->
	{#each grouped as [season, entries]}
		<section class="bs-sec">
			<div class="bs-arch-group-h">Season {season} · {entries.length} round{entries.length !== 1 ? 's' : ''}</div>
			<div class="bs-arch-list">
				{#each entries as entry}
					{@const isNew = entry.n === newestRound}
					{@const sub = submitter(entry.submitter)}
					{#if entry.digestUrl}
						<a class="bs-arch" href={entry.digestUrl} style:--hue={entry.hue}>
							<div class="bs-arch-n">{entry.n}</div>
							<div class="bs-arch-body">
								<div class="bs-arch-theme">{entry.theme}</div>
								<div class="bs-arch-win">
									{#if sub}<Avatar hue={sub.hue} initials={sub.initials} size="sm" />{/if}
									<span><b>{entry.winnerSong}</b> — {entry.winnerArtist}</span>
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
									{#if sub}<Avatar hue={sub.hue} initials={sub.initials} size="sm" />{/if}
									<span><b>{entry.winnerSong}</b> — {entry.winnerArtist}</span>
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
		</section>
	{/each}

	<!-- Footer -->
	<footer class="bs-footer">
		<div class="bs-mark bs-mark--sm">the b/side</div>
		<div class="bs-footer-note">{league.name} · {league.seasons} season{league.seasons !== 1 ? 's' : ''} archived · shareable, no login</div>
	</footer>
</div>
