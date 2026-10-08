<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import { validateSurvey, type Field, type SurveySchema } from '../lib/surveySchema.js';
	import { SurveyApiError } from '../lib/surveyApi.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';

	interface Props { nav: Nav; portal: PortalJson | null; }
	let { nav, portal }: Props = $props();
	const session = getPortalSession();

	let schema = $state<SurveySchema | null>(null);
	let values = $state<Record<string, unknown>>({});
	let error = $state<string | null>(null);
	let done = $state(session.hub?.submitted === true);
	let status = $state('');

	$effect(() => {
		session.api?.schema().then((s) => { schema = s as SurveySchema; }).catch((e: unknown) => {
			error = e instanceof Error ? e.message : 'Could not load the form.';
		});
	});

	function setValue(key: string, value: unknown) {
		values = { ...values, [key]: value };
	}

	function themeRows(field: Field): Record<string, unknown>[] {
		return Array.isArray(values[field.key]) ? [...(values[field.key] as Record<string, unknown>[])] : [];
	}

	function setRow(field: Field, index: number, subKey: string, value: unknown) {
		const list = themeRows(field);
		list[index] = { ...list[index], [subKey]: value };
		setValue(field.key, list);
	}

	async function submit() {
		if (!session.api || !schema) return;
		const checked = validateSurvey(schema, values);
		if (checked.error) { error = checked.error; return; }
		try {
			if (done) {
				const themes = (checked.values?.themes as unknown[]) ?? [];
				await session.api.addThemes(themes);
				status = 'Themes added.';
			} else {
				await session.api.submit(checked.values);
				done = true;
				status = "You're in. Add more themes anytime.";
			}
			error = null;
			await session.refresh();
		} catch (e) {
			if (e instanceof SurveyApiError && e.code === 'conflict') {
				done = true;
				error = e.message;
			} else {
				error = e instanceof Error ? e.message : 'Submit failed.';
			}
		}
	}
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="survey" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<h1 class="bs-hero-name">{done ? 'Add more themes' : 'Season survey'}</h1>
	</header>
	{#if error}<p class="err">{error}</p>{/if}
	{#if status}<p class="bs-sec-sub">{status}</p>{/if}
	{#if schema}
		{#each schema.sections as section}
			<section class="bs-sec">
				<h2 class="bs-sec-title">{section.heading}</h2>
				{#if section.intro}<p class="bs-sec-sub">{section.intro}</p>{/if}
				{#each section.fields as field}
					{#if field.type === 'longtext' || field.type === 'text' || field.type === 'email'}
						<label class="field">{field.label}
							{#if field.type === 'longtext'}
								<textarea rows="4" placeholder={field.placeholder ?? ''}
									oninput={(e) => setValue(field.key, e.currentTarget.value)}></textarea>
							{:else}
								<input placeholder={field.placeholder ?? ''}
									oninput={(e) => setValue(field.key, e.currentTarget.value)} />
							{/if}
						</label>
					{:else if field.type === 'singleChoice'}
						<fieldset class="field">
							<legend>{field.label}</legend>
							{#each field.options ?? [] as opt}
								<label class="row"><input type="radio" name={field.key} value={opt.value}
									onchange={() => setValue(field.key, opt.value)} /> {opt.label}</label>
							{/each}
						</fieldset>
					{:else if field.type === 'repeatGroup'}
						<p class="bs-sec-sub">{field.label}</p>
						{#each themeRows(field) as row, i}
							<div class="group">
								{#each field.fields ?? [] as sub}
									<label class="field">{sub.label}
										{#if sub.type === 'longtext'}
											<textarea rows="3" placeholder={sub.placeholder ?? ''}
												oninput={(e) => setRow(field, i, sub.key, e.currentTarget.value)}></textarea>
										{:else}
											<input placeholder={sub.placeholder ?? ''}
												oninput={(e) => setRow(field, i, sub.key, e.currentTarget.value)} />
										{/if}
									</label>
								{/each}
							</div>
						{/each}
						<button type="button" class="bs-share-btn" onclick={() => setValue(field.key, [...themeRows(field), {}])}>Add one</button>
					{/if}
				{/each}
			</section>
		{/each}
		<button class="bs-share-btn" onclick={submit}>{done ? 'Add themes' : 'Submit'}</button>
	{/if}
</div>

<style>
	.field { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; font-size: 13px; }
	.field input, .field textarea { padding: 10px 12px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); }
	.row { display: flex; gap: 8px; align-items: center; }
	.err { color: var(--ember); }
	.group { padding: 12px; margin: 8px 0; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--ink-1); }
</style>
