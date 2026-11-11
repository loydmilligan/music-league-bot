<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import type { LaughTrack } from '$lib/server/boarzStats/laughs.js';
	import ChatLaughTrack from '$lib/components/boarzStats/ChatLaughTrack.svelte';
	import type { RoundAward } from './awards.js';
	let { awards, snapshot, roundLaughTrack = null }: { awards: RoundAward[]; snapshot: Snapshot; roundLaughTrack?: LaughTrack | null } = $props();
	const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;
</script>

<div style="max-width:720px;margin:0 auto;padding:0 1rem 2rem">
	{#each awards as a (a.key)}
		<section id="award-{a.key}" style="margin:1.5rem 0;padding:1rem;border:1px solid #2a2a2a;border-radius:12px;background:#141414;font-family:system-ui">
			<h2 style="font:700 1.1rem system-ui;margin:0 0 .15rem">{a.name}</h2>
			<div style="font:.8rem system-ui;color:#888;margin-bottom:.75rem">Day {a.day}</div>
			{#if a.poster}
				<a href={a.poster} target="_blank" rel="noopener" aria-label="Open {a.name} poster full size">
					<img src={a.poster} alt="{a.name} poster" style="display:block;width:100%;height:auto;border-radius:8px;margin-bottom:.75rem" />
				</a>
			{/if}
			<ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem">
				{#each a.top3 as t (t.place)}
					<li style="display:flex;gap:.6rem;align-items:flex-start">
						<span style="font-size:1.2rem" aria-label="Place {t.place}">{MEDAL[t.place]}</span>
						<div style="min-width:0">
							<div style="font:600 .9rem system-ui;color:#fff">{t.who} <span style="font-weight:400;color:#888;font-size:.75rem">{t.when}</span>{#if t.emoji} <span>{t.emoji}</span>{/if}</div>
							<div style="font:.9rem/1.4 system-ui;color:#ddd;white-space:pre-wrap;overflow-wrap:anywhere">{t.text}</div>
						</div>
					</li>
				{/each}
			</ol>
			{#if a.key === 'bbb'}
				<div style="margin-top:1rem"><ChatLaughTrack snap={snapshot} roundTrack={roundLaughTrack} /></div>
			{/if}
		</section>
	{/each}
</div>
