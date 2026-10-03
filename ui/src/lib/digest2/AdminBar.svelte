<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	let { roundId, admin }: {
		roundId: number;
		admin: { draftGeneratedAt: string | null; published: { url: string; updatedAt: string } | null };
	} = $props();

	let busy = $state<'' | 'generate' | 'publish'>('');
	let err = $state('');
	let warn = $state('');
	let url = $state(admin.published?.url ?? '');
	let copied = $state(false);

	async function generate() {
		busy = 'generate'; err = '';
		try {
			const res = await fetch(`/api/digest/${roundId}/draft`, { method: 'POST' });
			if (!res.ok) throw new Error(`generate failed (${res.status}) ${(await res.text()).slice(0, 200)}`);
			await invalidateAll();
		} catch (e) { err = String(e instanceof Error ? e.message : e); }
		finally { busy = ''; }
	}

	async function publish() {
		if (admin.published && !confirm('Re-publish? The existing link stays the same but its content is replaced.')) return;
		busy = 'publish'; err = ''; warn = '';
		try {
			const res = await fetch(`/api/digest2/${roundId}/publish`, { method: 'POST' });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `publish failed (${res.status})`);
			url = body.url;
			warn = body.portalWarning ?? '';
			await invalidateAll();
		} catch (e) { err = String(e instanceof Error ? e.message : e); }
		finally { busy = ''; }
	}

	async function copy() {
		await navigator.clipboard.writeText(url);
		copied = true; setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="d2-admin">
	<p class="d2-admin-status">
		{admin.draftGeneratedAt ? `Story draft from ${admin.draftGeneratedAt.slice(0, 16).replace('T', ' ')} UTC` : 'No story draft yet'}
		{#if admin.published}· Published {admin.published.updatedAt.slice(0, 16).replace('T', ' ')} UTC{/if}
	</p>
	<div class="d2-admin-actions">
		{#if !admin.draftGeneratedAt}
			<button onclick={generate} disabled={busy !== ''}>{busy === 'generate' ? 'Generating… (can take a few minutes)' : 'Generate'}</button>
		{/if}
		<a href="/digest/{roundId}" data-sveltekit-reload>Edit story in 1.0 editor</a>
		<button onclick={publish} disabled={busy !== '' || !admin.draftGeneratedAt}>
			{busy === 'publish' ? 'Publishing…' : admin.published ? 'Re-publish' : 'Finalize & share'}
		</button>
	</div>
	{#if url}
		<p class="d2-admin-link"><a href={url} target="_blank" rel="noopener">{url}</a> <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button></p>
	{/if}
	{#if warn}<p class="d2-admin-err">{warn}</p>{/if}
	{#if err}<p class="d2-admin-err">{err}</p>{/if}
</div>

<style>
	.d2-admin { border: 1px solid #333; border-radius: 8px; padding: .6rem .8rem; margin: 0 0 .75rem; font: 500 .85rem/1.4 system-ui; }
	.d2-admin-status { margin: 0 0 .4rem; opacity: .75; }
	.d2-admin-actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
	.d2-admin-actions button, .d2-admin-link button { padding: .35rem .7rem; border-radius: 6px; border: 1px solid #555; background: #1c1c1c; color: #fff; cursor: pointer; }
	.d2-admin-actions button:disabled { opacity: .5; cursor: default; }
	.d2-admin-link { margin: .5rem 0 0; word-break: break-all; }
	.d2-admin-err { margin: .4rem 0 0; color: #ff6b6b; }
</style>
