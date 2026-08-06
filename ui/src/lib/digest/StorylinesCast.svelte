<script lang="ts" module>
  // ── storylines-render · sprint-storylines Task 5 (viz) ──────────────────
  // Visual form of the digest's `storylines` section. Renders the LLM-authored
  // "recurring characters" bits for this round's cast: a header (the section
  // title) followed by one card per cast member — name, headline, and the
  // curated evidence quotes that justified the bit.
  //
  // Implements the frontend VARIANT SLOT INTERFACE (`VisualComponentProps` in
  // variants.ts). Frontend registers this for kind 'storylines' (set
  // VISUAL_CAPABLE.storylines = true + VISUAL_COMPONENTS.storylines). Mounted as:
  //   <StorylinesCast {kind} {content} variant={'visual'|'both'} />
  // Reads the storylines section's content_json shape (backend, llm.ts
  // SECTION_SCHEMA.storylines):
  //   { title: string, cast: [{ name: string, headline: string, evidence: string[] }] }
  //
  // Defensive: the LLM's generic missing-kind fallback shape is
  // `{ title, body, items }` (NOT `{ title, cast }`) — so `content.cast` may be
  // undefined/missing/malformed. Always coerce to an array and render an
  // empty state rather than crash.
  //
  // Web and export (?export=1) render identically here — this is a static
  // list, not an accordion — but the mode is still threaded through so future
  // layout divergence (e.g. export-only pagination) has a hook.
  import type { VisualComponentProps } from './variants.js';

  export type StorylineCastMember = { name?: string; headline?: string; evidence?: string[] };
  export type StorylinesContent = { title?: string; cast?: StorylineCastMember[] };
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { content }: VisualComponentProps = $props();

  const c = $derived((content ?? {}) as StorylinesContent);
  const title = $derived(c.title?.trim() || 'The Regulars');
  const cast = $derived(
    Array.isArray(c.cast)
      ? c.cast
          .filter((m): m is StorylineCastMember => !!m && (!!m.name || !!m.headline))
          .map((m) => ({
            name: m.name ?? '',
            headline: m.headline ?? '',
            evidence: Array.isArray(m.evidence) ? m.evidence.filter((e): e is string => !!e?.trim()) : [],
          }))
      : [],
  );

  // Threaded through for future export-only layout divergence; unused today.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
</script>

<div class="stl" data-component="storylines-render" data-export={isExport}>
  {#if cast.length}
    <p class="stl-title">{title}</p>
    <div class="stl-cast">
      {#each cast as m, i (i)}
        <div class="stl-card">
          {#if m.name}<p class="stl-name">{m.name}</p>{/if}
          {#if m.headline}<p class="stl-headline">{m.headline}</p>{/if}
          {#if m.evidence.length}
            <ul class="stl-evidence">
              {#each m.evidence as quote, j (j)}
                <li class="stl-quote">"{quote}"</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="stl-empty">(no storylines this round)</p>
  {/if}
</div>

<style>
  .stl {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .stl-title {
    margin: 0;
    font: 700 13px/1.3 var(--font-body);
    color: var(--fg);
  }
  .stl-cast {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .stl-card {
    padding: 10px 12px;
    border-left: 2px solid var(--mash-pulp);
    background: var(--ink-0);
    border-radius: 0 var(--r-2) var(--r-2) 0;
    break-inside: avoid;
  }
  .stl-name {
    margin: 0 0 2px;
    font: 700 12.5px/1.3 var(--font-body);
    color: var(--fg);
  }
  .stl-headline {
    margin: 0 0 6px;
    font: 400 12.5px/1.5 var(--font-body);
    color: var(--fg-2);
  }
  .stl-evidence {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stl-quote {
    font: 400 12px/1.5 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }
  .stl-empty {
    margin: 0;
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
