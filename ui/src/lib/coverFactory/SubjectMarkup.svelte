<script lang="ts">
	import type { Subject } from './api';
	import { boxFromDrag, type Box } from './markup';

	let {
		src,
		alt,
		subjects,
		selected = null,
		redrawing = false,
		disabled = false,
		caption = 'Original',
		onselect,
		ondraw,
		onredraw,
	}: {
		src: string;
		alt: string;
		subjects: Subject[];
		caption?: string;
		selected?: string | null;
		redrawing?: boolean;
		disabled?: boolean;
		onselect: (label: string) => void;
		/** A finished drag: a new subject, or the selected subject's new box while `redrawing`. */
		ondraw: (box: Box) => void;
		onredraw: (on: boolean) => void;
	} = $props();

	const TONE: Record<Subject['role'], { box: string; tag: string; swatch: string; name: string }> = {
		main: { box: 'border-solid border-accent', tag: 'bg-accent', swatch: 'border-solid border-accent', name: 'Main' },
		secondary: { box: 'border-solid border-amber', tag: 'bg-amber', swatch: 'border-solid border-amber', name: 'Secondary' },
		background: { box: 'border-dashed border-sky', tag: 'bg-sky', swatch: 'border-dashed border-sky', name: 'Background' },
	};
	const tone = (r: Subject['role']) => TONE[r] ?? TONE.secondary;

	const boxed = $derived(subjects.filter((s): s is Subject & { box: Box } => !!s.box));
	const boxless = $derived(subjects.filter((s) => !s.box));
	const current = $derived(subjects.find((s) => s.label === selected) ?? null);

	let layer = $state<HTMLDivElement | null>(null);
	let start = $state<{ x: number; y: number } | null>(null);
	let end = $state<{ x: number; y: number } | null>(null);
	const draft = $derived(start && end ? boxFromDrag(start, end) : null);

	function frac(e: PointerEvent): { x: number; y: number } {
		const r = layer!.getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
	}

	function down(e: PointerEvent) {
		if (disabled || !layer || e.button !== 0) return;
		// A press on a box selects it (its click handler); only empty image area starts a drag.
		if (!redrawing && (e.target as HTMLElement).closest('button')) return;
		e.preventDefault();
		layer.setPointerCapture(e.pointerId);
		start = frac(e);
		end = start;
	}
	function move(e: PointerEvent) {
		if (start) end = frac(e);
	}
	function up(e: PointerEvent) {
		if (!start) return;
		const b = boxFromDrag(start, frac(e));
		start = end = null;
		if (b) ondraw(b);
	}
	function cancel() {
		start = end = null;
	}

	const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
	const place = (b: Box) => `left:${pct(b[0])};top:${pct(b[1])};width:${pct(b[2])};height:${pct(b[3])}`;
	const what = (s: Subject) => `${s.role} ${s.kind}`;
</script>

<div class="space-y-2.5">
	<figure class="space-y-2">
		<div class="relative rounded-md border border-border bg-bg overflow-hidden select-none">
			<img {src} {alt} draggable="false" class="block w-full h-auto" />
			<div
				bind:this={layer}
				class="absolute inset-0 touch-none {disabled ? '' : 'cursor-crosshair'}"
				role="presentation"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={cancel}
			>
				{#each boxed as s, i (i)}
					{@const t = tone(s.role)}
					{@const on = s.label === selected}
					<button
						type="button"
						class="absolute rounded-[3px] border-2 {t.box} transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg {on
							? 'ring-2 ring-fg/90 ring-offset-2 ring-offset-bg/60 bg-fg/10'
							: 'hover:bg-fg/10'} {redrawing ? 'pointer-events-none opacity-60' : ''}"
						style={place(s.box)}
						aria-label="Subject {s.label}, {what(s)}"
						aria-pressed={on}
						title="{s.label} · {what(s)}"
						onclick={() => onselect(s.label)}
					>
						<span class="absolute left-0 top-0 min-w-4 px-1 rounded-br-[3px] font-mono text-[10px] font-bold leading-4 text-bg {t.tag}">{s.label}</span>
					</button>
				{/each}
				{#if draft}
					<div class="absolute rounded-[3px] border-2 border-dashed border-fg bg-fg/10 pointer-events-none" style={place(draft)} aria-hidden="true"></div>
				{/if}
			</div>
		</div>

		<figcaption class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">{caption}</span>
			<span class="text-[11px] text-fg-dim">{redrawing ? `Drag on the cover to redraw ${selected}` : 'Click a box to select · drag to add'}</span>
		</figcaption>
	</figure>

	{#if current}
		<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted bg-bg-elevated px-2.5 py-1.5">
			<span class="flex items-center gap-2 min-w-0 text-xs text-fg-muted">
				<span class="shrink-0 min-w-5 px-1 rounded-sm text-center font-mono text-[10px] font-bold leading-4 text-bg {tone(current.role).tag}">{current.label}</span>
				<span class="truncate">{current.box ? what(current) : `${what(current)} · no box yet`}</span>
			</span>
			{#if redrawing}
				<button type="button" class="font-mono text-[10px] uppercase tracking-wider text-fg-dim hover:text-fg" onclick={() => onredraw(false)}>Cancel</button>
			{:else}
				<button type="button" class="font-mono text-[10px] uppercase tracking-wider text-accent hover:text-accent-strong disabled:opacity-50" {disabled} onclick={() => onredraw(true)}>
					{current.box ? 'Redraw box' : 'Draw box'}
				</button>
			{/if}
		</div>
	{/if}

	{#if boxless.length}
		<ul class="flex flex-wrap gap-1.5" aria-label="Subjects without a box">
			{#each boxless as s, i (i)}
				<li>
					<button
						type="button"
						class="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors {s.label === selected
							? 'border-fg/60 text-fg bg-surface-hover'
							: 'border-border-muted text-fg-dim hover:text-fg hover:border-border'}"
						aria-pressed={s.label === selected}
						onclick={() => onselect(s.label)}>{s.label} — no box</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	<ul class="flex flex-wrap gap-x-3 gap-y-1" aria-label="Box legend">
		{#each Object.values(TONE) as t (t.name)}
			<li class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
				<span class="inline-block h-2.5 w-3.5 rounded-[2px] border-2 {t.swatch}" aria-hidden="true"></span>{t.name}
			</li>
		{/each}
	</ul>
</div>
