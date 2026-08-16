<script lang="ts" module>
  // ── chat-render · sprint-15 (viz) ─────────────────────────────────────────
  // Visual form of the digest's `chat` section. Renders the restructured chat
  // content — a top summary, then a list of discrete chat "moments" — in TWO
  // render modes off one component:
  //   • WEB (interactive): each moment is a click-to-expand accordion
  //     (label → reveals detail).
  //   • EXPORT (static PNG/PDF): a summary block + the moment LABELS as an
  //     anchor-linked list that jumps to each moment's detail rendered lower
  //     down — because a static artifact can't truly expand. In a PDF the
  //     `#anchor` links are real clickable in-doc jumps; in a PNG the details
  //     are simply all visible.
  // Mode is detected from the page URL (`?export=1`, set by the export render
  // path — see export.ts / +page.svelte), NOT a prop: the variant slot
  // interface passes only VisualComponentProps.
  //
  // Implements the frontend VARIANT SLOT INTERFACE (`VisualComponentProps` in
  // variants.ts). Frontend registers this for kind 'chat' (set
  // VISUAL_CAPABLE.chat = true + VISUAL_COMPONENTS.chat). Mounted as:
  //   <ChatMoments {kind} {content} data={visualData} variant={'visual'|'both'} />
  // Reads the chat section's content_json shape (backend chat-restructure):
  //   { summary: string, moments: [{ label: string, detail: string }] }
  // Defensive: tolerates the old prose shape (renders empty → frontend wires
  // it once the restructured content lands).
  import type { VisualComponentProps } from './variants.js';

  export type ChatMoment = { label?: string; detail?: string; description?: string; quote?: string };
  export type ChatContent = { summary?: string; moments?: ChatMoment[] };
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { content }: VisualComponentProps = $props();

  // Stable, collision-proof anchor base (unique per instance, SSR/CSR-safe).
  const uid = $props.id();
  const anchorId = (i: number) => `${uid}-m${i}`;

  const c = $derived((content ?? {}) as ChatContent);
  const summary = $derived(c.summary?.trim() ?? '');
  const moments = $derived(
    Array.isArray(c.moments)
      ? c.moments
          // Tolerate the LLM emitting a moment's body under `description` (the
          // renderer reads `detail`) — normalize before filtering.
          .map((m) => ({ ...m, detail: m?.detail ?? m?.description ?? m?.quote }) as ChatMoment)
          .filter((m): m is ChatMoment => !!m && (!!m.label || !!m.detail))
      : [],
  );

  // Static (PNG/PDF) export can't expand → render the anchor-linked variant.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  // Accordion open-state (web only).
  let open = $state<Record<number, boolean>>({});
  function toggle(i: number) {
    open = { ...open, [i]: !open[i] };
  }
</script>

<div class="chatm" data-component="chat-render">
  {#if summary}
    <p class="chatm-summary">{summary}</p>
  {/if}

  {#if moments.length}
    {#if isExport}
      <!-- static: labels link down to the detail blocks (PDF clickable jumps) -->
      <ol class="chatm-toc">
        {#each moments as m, i (i)}
          <li>
            <a class="chatm-toc-link" href={`#${anchorId(i)}`}>
              <span class="chatm-toc-num">{String(i + 1).padStart(2, '0')}</span>
              <span class="chatm-toc-label">{m.label ?? `Moment ${i + 1}`}</span>
              <span class="chatm-toc-jump" aria-hidden="true">↓</span>
            </a>
          </li>
        {/each}
      </ol>
      <div class="chatm-details">
        {#each moments as m, i (i)}
          <div class="chatm-detail" id={anchorId(i)}>
            <p class="chatm-detail-label">
              <span class="chatm-detail-num">{String(i + 1).padStart(2, '0')}</span>{m.label ?? ''}
            </p>
            {#if m.detail}<p class="chatm-detail-body">{m.detail}</p>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <!-- web: click-to-expand accordion -->
      <div class="chatm-acc">
        {#each moments as m, i (i)}
          <div class="chatm-item" class:is-open={open[i]}>
            <button
              type="button"
              class="chatm-trigger"
              aria-expanded={open[i] ?? false}
              aria-controls={anchorId(i)}
              onclick={() => toggle(i)}
            >
              <span class="chatm-chevron" aria-hidden="true">▸</span>
              <span class="chatm-label">{m.label ?? `Moment ${i + 1}`}</span>
            </button>
            {#if open[i]}
              <div class="chatm-panel" id={anchorId(i)} role="region">
                {#if m.detail}<p class="chatm-detail-body">{m.detail}</p>{:else}<p
                    class="chatm-detail-body chatm-empty"
                  >(no detail)</p>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if !summary && !moments.length}
    <p class="chatm-empty">(no chat moments)</p>
  {/if}
</div>

<style>
  .chatm {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .chatm-summary {
    margin: 0;
    font: 400 13px/1.55 var(--font-body);
    color: var(--fg-2);
    white-space: pre-wrap;
  }

  /* ── web accordion ───────────────────────────────────────────────────── */
  .chatm-acc {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .chatm-item {
    border-bottom: 1px solid var(--line);
  }
  .chatm-item:last-child {
    border-bottom: 0;
  }
  .chatm-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    background: var(--ink-0);
    border: 0;
    text-align: left;
    cursor: pointer;
    color: var(--fg);
    transition: background var(--dur-fast) var(--ease-out);
  }
  .chatm-trigger:hover {
    background: var(--surface-hover);
  }
  .chatm-chevron {
    flex-shrink: 0;
    font: 700 14px/1 var(--font-mono);
    color: var(--mash-pulp);
    transition: transform var(--dur-fast) var(--ease-out);
    /* readers kept missing that the moments expand — closed chevrons shimmer
       until opened, as a "there's more here" affordance */
    animation: chatm-shimmer 2.2s ease-in-out infinite;
  }
  .chatm-item.is-open .chatm-chevron {
    transform: rotate(90deg);
    animation: none;
  }
  @keyframes chatm-shimmer {
    0%,
    100% {
      color: var(--mash-pulp);
      text-shadow: none;
    }
    50% {
      color: var(--amber);
      text-shadow: 0 0 6px var(--amber-soft);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chatm-chevron {
      animation: none;
      color: var(--amber);
    }
  }
  .chatm-label {
    font: 600 12.5px/1.3 var(--font-body);
    color: var(--fg);
  }
  .chatm-panel {
    padding: 0 12px 11px 30px;
    background: var(--ink-0);
  }

  /* ── export: anchor-linked TOC + detail blocks ───────────────────────── */
  .chatm-toc {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .chatm-toc li {
    border-bottom: 1px solid var(--line);
  }
  .chatm-toc li:last-child {
    border-bottom: 0;
  }
  .chatm-toc-link {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 9px 12px;
    text-decoration: none;
    color: var(--fg);
    background: var(--ink-0);
  }
  .chatm-toc-num,
  .chatm-detail-num {
    flex-shrink: 0;
    font: 700 10px/1.3 var(--font-mono);
    color: var(--mash-pulp);
    font-variant-numeric: tabular-nums;
  }
  .chatm-detail-num {
    margin-right: 7px;
  }
  .chatm-toc-label {
    flex: 1;
    font: 600 12.5px/1.3 var(--font-body);
    color: var(--fg);
  }
  .chatm-toc-jump {
    flex-shrink: 0;
    font: 600 11px/1 var(--font-mono);
    color: var(--fg-quiet);
  }
  .chatm-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .chatm-detail {
    padding: 10px 12px;
    border-left: 2px solid var(--mash-pulp);
    background: var(--ink-0);
    border-radius: 0 var(--r-2) var(--r-2) 0;
    /* keep a moment + its detail from splitting across a PDF page break */
    break-inside: avoid;
  }
  .chatm-detail-label {
    margin: 0 0 4px;
    font: 700 13px/1.3 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: baseline;
  }

  /* shared */
  .chatm-detail-body {
    margin: 0;
    font: 400 12.5px/1.55 var(--font-body);
    color: var(--fg-2);
    white-space: pre-wrap;
  }
  .chatm-empty {
    color: var(--fg-quiet);
    font-style: italic;
  }

  @media (max-width: 460px) {
    .chatm-panel {
      padding-left: 24px;
    }
  }
</style>
