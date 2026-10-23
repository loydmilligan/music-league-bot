<script lang="ts">
	import { Chart } from 'chart.js/auto';
	import type { ChartConfiguration } from 'chart.js';
	import { onMount, untrack } from 'svelte';
	Chart.defaults.color = '#94a3b8';
	Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.12)';
	Chart.defaults.font.family = 'ui-sans-serif, system-ui, sans-serif';

	let {
		config,
		height = 300,
		zoomable = false,
		zoomMode = 'xy',
		initialRange = null,
	}: {
		config: ChartConfiguration<any>;
		height?: number;
		zoomable?: boolean;
		zoomMode?: 'x' | 'y' | 'xy';
		/** x index window to open on (zoomable charts only); Reset still shows everything. */
		initialRange?: [number, number] | null;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: Chart | undefined;
	let zoomReady = $state(!zoomable);
	let brushStart = $state(0);
	let brushEnd = $state<number | null>(null);
	const pointCount = $derived((config.data.labels?.length ?? 0));
	function updateBrush(which: 'start' | 'end', value: number) {
		const max = Math.max(pointCount - 1, 0);
		if (which === 'start') brushStart = Math.min(value, (brushEnd ?? max) - 1);
		else brushEnd = Math.max(value, brushStart + 1);
		if (chart?.options.scales?.x) {
			(chart.options.scales.x as any).min = brushStart;
			(chart.options.scales.x as any).max = brushEnd ?? max;
			chart.update('none');
		}
	}
	function syncBrushToChart(context: { chart: Chart }) {
		const scale = context.chart.scales.x;
		if (!scale) return;
		brushStart = Math.max(0, Math.floor(Number(scale.min) || 0));
		brushEnd = Math.min(pointCount - 1, Math.ceil(Number(scale.max) || pointCount - 1));
	}
	function resetChart() {
		chart?.resetZoom();
		// resetZoom returns to the configured window (and re-syncs the brush to it);
		// Reset means the whole series.
		if (initialRange && chart?.options.scales?.x) {
			(chart.options.scales.x as any).min = undefined;
			(chart.options.scales.x as any).max = undefined;
			chart.update('none');
		}
		brushStart = 0;
		brushEnd = Math.max(pointCount - 1, 0);
	}
	$effect(() => {
		const count = pointCount;
		const max = Math.max(count - 1, 0);
		const [from, to] = zoomable && initialRange ? initialRange : [0, max];
		const start = Math.min(Math.max(from, 0), max);
		brushStart = start;
		brushEnd = Math.min(Math.max(to, start), max);
	});

	onMount(async () => {
		if (!zoomable) return;
		const { default: zoomPlugin } = await import('chartjs-plugin-zoom');
		Chart.register(zoomPlugin);
		zoomReady = true;
	});

	$effect(() => {
		const el = canvas;
		if (!el || !zoomReady) return;
		// untrack: the brush moves on every zoom — reading it here would rebuild the chart each time.
		const opening = initialRange ? untrack(() => ({ min: brushStart, max: brushEnd ?? pointCount - 1 })) : {};
		const chartConfig = zoomable
			? {
					...config,
					options: {
						...config.options,
						scales: { ...config.options?.scales, x: { ...config.options?.scales?.x, ...opening } },
						plugins: {
							...config.options?.plugins,
							zoom: {
								pan: { enabled: true, mode: zoomMode, modifierKey: 'shift', onPanComplete: syncBrushToChart },
								zoom: { wheel: { enabled: true, speed: 0.08, modifierKey: 'ctrl' }, pinch: { enabled: true }, drag: { enabled: true, mode: zoomMode, modifierKey: 'ctrl', threshold: 8 }, mode: zoomMode, onZoomComplete: syncBrushToChart },
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
			<span class="mr-1 hidden text-[11px] text-fg-muted sm:inline">Ctrl-drag to select · Ctrl-wheel to zoom · Shift-drag to pan</span>
			<button type="button" class="zoom-button" aria-label="Zoom in" title="Zoom in" onclick={() => chart?.zoom(1.2)}>＋</button>
			<button type="button" class="zoom-button" aria-label="Zoom out" title="Zoom out" onclick={() => chart?.zoom(0.8)}>−</button>
			<button type="button" class="zoom-button" aria-label="Pan left" title="Pan left" onclick={() => chart?.pan({ x: -100, y: 0 })}>←</button>
			<button type="button" class="zoom-button" aria-label="Pan right" title="Pan right" onclick={() => chart?.pan({ x: 100, y: 0 })}>→</button>
			<button type="button" class="zoom-button px-2!" onclick={resetChart}>Reset</button>
		</div>
		{#if zoomable && pointCount > 2}
			<details class="mb-2 rounded-lg border border-border-muted bg-surface/40 px-3 py-2" data-noshot>
				<summary class="cursor-pointer text-xs text-fg-muted">Chart window · {brushStart + 1}–{(brushEnd ?? pointCount - 1) + 1} of {pointCount}</summary>
				<div class="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
					<label for="brush-start">Start</label><input id="brush-start" aria-label="Visible chart range start" type="range" min="0" max={pointCount - 2} value={brushStart} oninput={(event) => updateBrush('start', Number(event.currentTarget.value))} />
					<label for="brush-end">End</label><input id="brush-end" aria-label="Visible chart range end" type="range" min="1" max={pointCount - 1} value={brushEnd ?? pointCount - 1} oninput={(event) => updateBrush('end', Number(event.currentTarget.value))} />
				</div>
			</details>
		{/if}
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
