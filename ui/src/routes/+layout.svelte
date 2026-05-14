<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<nav class="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900">
	<a href="/" class="text-purple-400 font-bold text-lg">🎵 Music League</a>
	<a href="/settings" class="text-slate-400 hover:text-slate-200 text-xl" title="Settings">⚙</a>
</nav>
<main class="max-w-6xl mx-auto px-6 py-8">
	{@render children?.()}
</main>
