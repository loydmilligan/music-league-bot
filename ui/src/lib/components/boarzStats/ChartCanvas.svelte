<script lang="ts">
	import { Chart } from 'chart.js/auto';
	import type { ChartConfiguration } from 'chart.js';
	import { onMount } from 'svelte';
	Chart.defaults.color = '#94a3b8';
	Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.12)';
	Chart.defaults.font.family = 'ui-sans-serif, system-ui, sans-serif';

	let {
		config,
		height = 300,
		zoomable = false,
		zoomMode = 'xy',
	}: {
		config: ChartConfiguration<any>;
		height?: number;
		zoomable?: boolean;
		zoomMode?: 'x' | 'y' | 'xy';
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: Chart | undefined;
	let zoomReady = $state(!zoomable);

	onMount(async () => {
		if (!zoomable) return;
		const { default: zoomPlugin } = await import('chartjs-plugin-zoom');
		Chart.register(zoomPlugin);
		zoomReady = true;
	});

	$effect(() => {
		const el = canvas;
		if (!el || !zoomReady) return;
		const chartConfig = zoomable
			? {
					...config,
					options: {
						...config.options,
						plugins: {
							...config.options?.plugins,
							zoom: {
								pan: { enabled: true, mode: zoomMode, modifierKey: 'shift' },
								zoom: { wheel: { enabled: true, speed: 0.08 }, pinch: { enabled: true }, mode: zoomMode },
							},
						},
					},
				}
			: config;
		chart = new Chart(el, chartConfig as ChartConfiguration<any>);
		return () => {
			chart?.destroy();
			chart = undefined;
		};
	});
</script>

<div class="relative">
	{#if zoomable}
		<div class="mb-2 flex items-center justify-end gap-1" data-noshot>
			<span class="mr-1 hidden text-[11px] text-fg-muted sm:inline">Wheel to zoom · Shift-drag to pan</span>
			<button type="button" class="zoom-button" aria-label="Zoom in" title="Zoom in" onclick={() => chart?.zoom(1.2)}>＋</button>
			<button type="button" class="zoom-button" aria-label="Zoom out" title="Zoom out" onclick={() => chart?.zoom(0.8)}>−</button>
			<button type="button" class="zoom-button px-2!" onclick={() => chart?.resetZoom()}>Reset</button>
		</div>
	{/if}
	<div style="height: {height}px">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>

<style>
	.zoom-button {
		min-width: 1.8rem;
		height: 1.8rem;
		border: 1px solid var(--color-border-muted);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--color-surface) 80%, transparent);
		font-size: 0.75rem;
		color: var(--color-fg-muted);
	}
	.zoom-button:hover { color: var(--color-fg); border-color: var(--color-fg-muted); }
</style>
