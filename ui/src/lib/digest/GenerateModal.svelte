<script lang="ts">
  // Initial-generation modal (sprint-14 generate-modal). Per-section checkbox
  // (default checked) + expandable per-section controls (style words / context /
  // Textual·Visual·Both picker), plus a dedicated paste-WhatsApp-chat box.
  // On submit it posts the **Generation params** contract to POST /draft:
  //   { sections: [{ id, enabled, style, variant, context }], pastedChat }
  // where `id` is the section KIND (backend validates against SECTION_KINDS,
  // honors `enabled`, injects style/context, respects variant, and uses
  // pastedChat as the chat section's source).
  import { SECTION_KINDS, type SectionKind } from './llm.js';
  import { TOP_SECTION_VARIANTS, TOP_SECTION_VISUALS, TOP_SECTION_VARIANT_META, type TopSectionVariant, type TopSectionVisual } from './topSectionVariants.js';
  import {
    VISUAL_CAPABLE,
    VARIANT_ICON,
    VARIANT_LABEL,
    SECTION_VARIANTS,
    DEFAULT_VARIANT,
    type SectionVariant,
  } from './variants.js';

  export type GenSection = {
    id: SectionKind;
    enabled: boolean;
    style: string[];
    variant: SectionVariant;
    context: string;
  };
  // Standings is a DATA section (computed from votes, not LLM prose), so it
  // carries no style/variant — just include + a recompute (adopt computed) opt.
  export type StandingsGenOpt = { include: boolean; recompute: boolean };
  // The other synthetic DATA sections (stats / next-round / Tastemaker) are pure
  // recompute — no LLM prompt path. Their only control is include/exclude.
  export type DataGenOpt = { include: boolean };
  // Season-recap mode (sprint-21). `enabled` re-renders every section at season
  // scope (rounds ≤ this digest's round); `final` drives framing only (champion /
  // past tense when true, "season so far / through R{N}" when false). Backend
  // (recap-generate-wiring) reads this off the /draft body.
  export type RecapGenOpt = { enabled: boolean; final: boolean };
  export type GenerateParams = {
    sections: GenSection[];
    pastedChat: string;
    standings: StandingsGenOpt;
    stats: DataGenOpt;
    topSectionVariant: TopSectionVariant;
    topSectionVisuals: TopSectionVisual[];
    nextRound: DataGenOpt;
    tastemaker: DataGenOpt;
    guesser: DataGenOpt;
    sonicSignatures: DataGenOpt;
    recap: RecapGenOpt;
    regenAvatars: boolean;
    /** Which deterministic parts print under the Back cover chat section. */
    chatParts: Record<string, boolean>;
  };

  // Availability state for a DATA section's indicator. 'ready' = the underlying
  // data is present and the section will render; 'incomplete' = it self-suppresses
  // (no/partial data) until the source is populated. (Tastemaker 'incomplete' =
  // <80% popularity coverage; stats/next-round = the round has no such data yet.)
  export type DataAvailability = 'ready' | 'incomplete';
  // Back-compat alias — the page used to pass `tastemakerCoverage`.
  export type TastemakerCoverage = DataAvailability;

  type Props = {
    sectionLabels: Record<SectionKind, string>;
    busy?: boolean;
    statsAvailability?: DataAvailability;
    standingsAvailability?: DataAvailability;
    nextRoundAvailability?: DataAvailability;
    tastemakerCoverage?: DataAvailability;
    guesserAvailability?: DataAvailability;
    onCancel: () => void;
    onSubmit: (params: GenerateParams) => void;
  };
  let {
    sectionLabels,
    busy = false,
    statsAvailability = 'incomplete',
    standingsAvailability = 'ready',
    nextRoundAvailability = 'incomplete',
    tastemakerCoverage = 'incomplete',
    guesserAvailability = 'incomplete',
    onCancel,
    onSubmit,
  }: Props = $props();

  // Style / focus tags — plain descriptors (replaces the regen modal's
  // "more/less ___" phrasing). Combinable per section.
  const STYLE_TAGS = ['mean', 'nice', 'negative', 'positive', 'concise', 'funny', 'dramatic', 'factual'];

  let sections = $state<GenSection[]>(
    SECTION_KINDS.map((k) => ({
      id: k,
      enabled: true,
      style: [],
      variant: DEFAULT_VARIANT,
      context: '',
    })),
  );
  /**
   * Deterministic parts that print under the Back cover chat section. They are
   * computed from chat_messages rather than generated, so they are choices
   * about what to PRINT, not what to ask the model for.
   */
  const CHAT_PARTS = [
    { id: 'chart', label: 'The chart', hint: 'Alternates each round between the activity heatmap and a who-talked ranking.' },
    { id: 'feature', label: 'Feature visual', hint: 'Rotates: biggest word, longest words, message triptych, shared tracks.' },
    { id: 'superlatives', label: 'Superlatives', hint: 'Four awards, rotating through a pool of twelve.' },
  ] as const;
  let chatParts = $state<Record<string, boolean>>({ chart: true, feature: true, superlatives: true });

  let pastedChat = $state('');
  let expanded = $state<Record<string, boolean>>({});

  // Standings data-section controls (sprint-15 polish). include = render the
  // season-standings chart in the digest; recompute = adopt the freshly-computed
  // values as the new gospel on generate (else the stored table is kept and a
  // mismatch surfaces the reconciliation modal).
  let standingsInclude = $state(true);
  let standingsRecompute = $state(false);

  // The other synthetic DATA sections — include toggles, default ON. Pure data, so
  // no recompute opt: regen always recomputes them from source on load.
  let statsInclude = $state(true);
  let topSectionVariant = $state<TopSectionVariant>("auto");
  let topSectionVisuals = $state<TopSectionVisual[]>([]);
  function toggleTopSectionVisual(visual: TopSectionVisual) {
    topSectionVisuals = topSectionVisuals.includes(visual)
      ? topSectionVisuals.filter((v) => v !== visual)
      : [...topSectionVisuals, visual];
  }
  let nextRoundInclude = $state(true);
  let tastemakerInclude = $state(true);
  // The Guesser — deterministic, opt-in per league; include toggle mirrors the
  // other DATA sections. Availability reflects whether the round has a detected
  // guesser with attempts (else the section self-suppresses).
  let guesserInclude = $state(true);
  // Sonic Signatures — embed each player's taste waveform in their digest card. Opt-in.
  let sonicSignaturesInclude = $state(false);

  // Shared indicator markup helper data (keeps the rows uniform).
  function covLabel(a: DataAvailability): string {
    return a === 'ready' ? '● coverage ready' : '⚠ incomplete coverage';
  }

  // Avatar regen toggle (Task 7). Default OFF — unchecked.
  let regenAvatars = $state(false);

  // Season-recap mode (sprint-21). Default OFF; when ON the "Final recap"
  // sub-toggle defaults ON (OFF = mid-season framing).
  let recapEnabled = $state(false);
  let recapFinal = $state(true);
  const recapBadge = $derived(`Season recap · ${recapFinal ? 'final' : 'so far'}`);

  function toggleExpand(id: string) {
    expanded[id] = !expanded[id];
  }
  function toggleStyle(s: GenSection, tag: string) {
    s.style = s.style.includes(tag) ? s.style.filter((t) => t !== tag) : [...s.style, tag];
  }

  const enabledCount = $derived(sections.filter((s) => s.enabled).length);

  function submit() {
    onSubmit({
      sections: $state.snapshot(sections),
      pastedChat,
      standings: { include: standingsInclude, recompute: standingsRecompute },
      stats: { include: statsInclude },
      topSectionVariant,
      topSectionVisuals,
      nextRound: { include: nextRoundInclude },
      tastemaker: { include: tastemakerInclude },
      guesser: { include: guesserInclude },
      sonicSignatures: { include: sonicSignaturesInclude },
      recap: { enabled: recapEnabled, final: recapFinal },
      regenAvatars,
      chatParts: $state.snapshot(chatParts),
    });
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="dg-modal-scrim"
  onclick={handleScrim}
  role="dialog"
  aria-modal="true"
  aria-label="Generate digest"
  tabindex="-1"
>
  <div class="dg-modal dg-genmodal">
    <header class="dg-modal-head">
      <h3>
        Generate {recapEnabled ? 'recap' : 'digest'} ·
        <span style="color: var(--mash-pulp);">{enabledCount}/{sections.length} sections</span>
      </h3>
      <button type="button" class="x" onclick={onCancel} aria-label="Close">✕</button>
    </header>

    <div class="dg-modal-body">
      <span class="dg-modal-eyebrow">Sections · check to include · expand for style / context / layout</span>
      <div class="dg-gen-sections">
        <!-- Season recap — re-renders every section at season scope. Same row shell as
             every other section; its own sub-controls (final toggle, note) live inline. -->
        <div class="dg-gen-row" class:is-off={!recapEnabled}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={recapEnabled} />
              <span class="dg-gen-name">Season recap</span>
            </label>
            {#if recapEnabled}
              <span class="dg-recap-badge">{recapBadge}</span>
            {/if}
          </div>
          {#if recapEnabled}
            <div class="dg-gen-controls">
              <label class="dg-recap-final" title="Final = definitive full-season framing; off = mid-season 'so far'">
                <input type="checkbox" bind:checked={recapFinal} />
                <span>Final recap</span>
              </label>
              <span class="dg-recap-hint">
                {recapFinal
                  ? 'Definitive full-season framing — champion, past tense.'
                  : 'Mid-season framing — "the season so far", current leader.'}
              </span>
              <p class="dg-recap-note">
                Re-renders every section across the whole season (rounds up to this one). Next-round
                preview is dropped; chat uses its paste box below.
              </p>
            </div>
          {/if}
        </div>
        {#each sections as s (s.id)}
          {@const canVisual = VISUAL_CAPABLE[s.id]}
          <div class="dg-gen-row" class:is-off={!s.enabled}>
            <div class="dg-gen-rowhead">
              <label class="dg-gen-check">
                <input type="checkbox" bind:checked={s.enabled} />
                <span class="dg-gen-name">{sectionLabels[s.id] ?? s.id}</span>
              </label>
              <div class="dg-gen-rowmeta">
                {#if s.style.length}<span class="dg-gen-count">{s.style.length} style</span>{/if}
                {#if s.context.trim()}<span class="dg-gen-count">context</span>{/if}
                {#if canVisual && s.variant !== 'textual'}<span class="dg-gen-count">{VARIANT_ICON[s.variant]}</span>{/if}
                <button
                  type="button"
                  class="dg-gen-expand"
                  onclick={() => toggleExpand(s.id)}
                  aria-expanded={!!expanded[s.id]}
                  title="Expand controls"
                >{expanded[s.id] ? '▾' : '▸'}</button>
              </div>
            </div>

            {#if expanded[s.id]}
              <div class="dg-gen-controls">
                <span class="dg-gen-label">style / focus</span>
                <div class="dg-modal-chips">
                  {#each STYLE_TAGS as tag (tag)}
                    <button
                      type="button"
                      class="dg-modal-chip"
                      class:is-on={s.style.includes(tag)}
                      onclick={() => toggleStyle(s, tag)}
                      disabled={!s.enabled}
                    >{tag}</button>
                  {/each}
                </div>

                <span class="dg-gen-label">context · optional</span>
                <textarea
                  class="dg-modal-textarea dg-gen-context"
                  bind:value={s.context}
                  placeholder="Anything this section should know or focus on…"
                  disabled={!s.enabled}
                ></textarea>

                <span class="dg-gen-label">layout</span>
                {#if canVisual}
                  <div class="dg-variant-pick" role="group" aria-label="Layout variant">
                    {#each SECTION_VARIANTS as v (v)}
                      <button
                        type="button"
                        class="dg-vpk-btn"
                        class:is-on={s.variant === v}
                        onclick={() => (s.variant = v)}
                        disabled={!s.enabled}
                      >
                        <span class="dg-vpk-icon">{VARIANT_ICON[v]}</span>
                        <span>{VARIANT_LABEL[v]}</span>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <p class="dg-gen-note">{VARIANT_ICON.textual} textual only — this section has no visual form</p>
                {/if}

                {#if s.id === 'chat'}
                  <span class="dg-gen-label">paste whatsapp chat · optional</span>
                  <textarea
                    class="dg-modal-textarea dg-gen-context"
                    bind:value={pastedChat}
                    placeholder="Paste the round's WhatsApp chat here. Used as this section's source (overrides the flaky auto-capture)."
                    disabled={!s.enabled}
                  ></textarea>

                  <!-- Deterministic chat parts. Subsidiaries of this section, so
                       one block governs everything that prints on the back cover. -->
                  <span class="dg-gen-label">back cover extras · computed, not LLM</span>
                  <div class="dg-gen-subparts">
                    {#each CHAT_PARTS as part (part.id)}
                      <label class="dg-gen-check dg-gen-subcheck">
                        <input
                          type="checkbox"
                          checked={chatParts[part.id]}
                          disabled={!s.enabled}
                          onchange={(e) => (chatParts = { ...chatParts, [part.id]: e.currentTarget.checked })}
                        />
                        <span class="dg-gen-name">{part.label}</span>
                        <span class="dg-gen-databadge">data</span>
                      </label>
                      <p class="dg-gen-note dg-gen-subnote">{part.hint}</p>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}

        <!-- Stats strip: a DATA section (by-the-numbers, computed not LLM). -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!statsInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={statsInclude} />
              <span class="dg-gen-name">By the numbers</span>
              <span class="dg-gen-databadge">data</span>
            </label>
            <span
              class="dg-gen-cov {statsAvailability === 'ready' ? 'dg-gen-cov--ok' : 'dg-gen-cov--warn'}"
              title={statsAvailability === 'ready' ? 'Round stats are computable — the strip will render' : 'No computable stats yet — the section self-suppresses'}
            >{covLabel(statsAvailability)}</span>
          </div>
          <p class="dg-gen-note">
            Vote/submission tallies for the round. Pure data — regenerate recomputes it; no LLM prompt.
          </p>
          <div class="dg-top-variant">
            <span class="dg-gen-label">deterministic visuals · no model</span>
            <select bind:value={topSectionVariant} disabled={!statsInclude} aria-label="Deterministic digest visual mode">
              {#each TOP_SECTION_VARIANTS as variant (variant)}
                <option value={variant}>{TOP_SECTION_VARIANT_META[variant].label}</option>
              {/each}
            </select>
            <span class="dg-top-variant-hint">{TOP_SECTION_VARIANT_META[topSectionVariant].description}</span>
            <div class="dg-top-visuals" aria-label="Include specific deterministic visuals">
              {#each TOP_SECTION_VISUALS as visual (visual)}
                <label><input type="checkbox" checked={topSectionVisuals.includes(visual)} onchange={() => toggleTopSectionVisual(visual)} disabled={!statsInclude || topSectionVariant !== "auto"} /> {TOP_SECTION_VARIANT_META[visual].label}</label>
              {/each}
            </div>
            <small class="dg-top-variant-hint">Auto selects one visual unless specific visuals are checked. This section is deterministic and never uses the configured AI model.</small>
          </div>
        </div>

        <!-- Standings: a DATA section (computed from votes, not LLM prose). -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!standingsInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={standingsInclude} />
              <span class="dg-gen-name">Season standings</span>
              <span class="dg-gen-databadge">data</span>
              {#if standingsAvailability === 'ready'}
                <span class="dg-gen-cov dg-gen-cov--ok" title="Vote data is present — the chart will render">● coverage ready</span>
              {:else}
                <span class="dg-gen-cov dg-gen-cov--warn" title="No computable standings yet — the section self-suppresses">⚠ incomplete coverage</span>
              {/if}
            </label>
            <label class="dg-gen-recompute" title="Recompute standings from votes and adopt as the new gospel">
              <input type="checkbox" bind:checked={standingsRecompute} disabled={!standingsInclude} />
              <span>recompute from votes</span>
            </label>
          </div>
          <p class="dg-gen-note">
            Computed from votes, not written by the LLM — auto-reconciled against the stored table on
            generate (a mismatch pops the reconcile modal). "Recompute" overwrites the gospel with the
            fresh computed values.
          </p>
          <label class="dg-av-regen" style="padding: 0 12px 10px;">
            <input type="checkbox" bind:checked={regenAvatars} />
            <span>Regenerate themed avatars for this round · avatars render here, in Standings</span>
          </label>
        </div>

        <!-- Sonic Signatures: embed each player's taste waveform in their digest card. -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!sonicSignaturesInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={sonicSignaturesInclude} />
              <span class="dg-gen-name">Sonic Signatures</span>
              <span class="dg-gen-databadge">data</span>
            </label>
          </div>
          <p class="dg-gen-note">
            Embed each player's taste waveform (a mini mark + archetype) in their digest card.
            Computed from their submissions — no LLM prompt.
          </p>
        </div>

        <!-- Next-round preview: a DATA section (theme/deadline, not LLM prose). -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!nextRoundInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={nextRoundInclude} />
              <span class="dg-gen-name">Next-round preview</span>
              <span class="dg-gen-databadge">data</span>
            </label>
            <span
              class="dg-gen-cov {nextRoundAvailability === 'ready' ? 'dg-gen-cov--ok' : 'dg-gen-cov--warn'}"
              title={nextRoundAvailability === 'ready' ? 'A next round with a theme/deadline exists — the preview will render' : 'No next round yet — the section self-suppresses'}
            >{nextRoundAvailability === 'ready' ? '● coverage ready' : '⚠ no next round yet'}</span>
          </div>
          <p class="dg-gen-note">
            Theme + deadline for the upcoming round. Pure data — regenerate recomputes it; no LLM prompt.
          </p>
        </div>

        <!-- Tastemaker (discoverability v2): a DATA section (median percentile from
             Last.fm popularity, not LLM prose). Include toggle + coverage indicator. -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!tastemakerInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={tastemakerInclude} />
              <span class="dg-gen-name">Tastemaker</span>
              <span class="dg-gen-databadge">data</span>
            </label>
            {#if tastemakerCoverage === 'ready'}
              <span class="dg-gen-cov dg-gen-cov--ok" title="Popularity coverage is sufficient — the section will render">● coverage ready</span>
            {:else}
              <span class="dg-gen-cov dg-gen-cov--warn" title="Popularity data is absent or below the 80% threshold — the section self-suppresses until backfilled">⚠ incomplete coverage</span>
            {/if}
          </div>
          <p class="dg-gen-note">
            Per-player season taste profile (median discovery percentile from Last.fm). Pure data —
            regenerate recomputes it from the latest popularity backfill; no LLM prompt.
            {#if tastemakerCoverage !== 'ready'}
              Hidden until ≥80% of the season has popularity data.
            {/if}
          </p>
        </div>

        <!-- The Guesser: a DATA section (deterministic; scores vote-comment
             guesses of who submitted what). Opt-in per league; include toggle +
             availability indicator. Move/lock/edit/regenerate live on the card. -->
        <div class="dg-gen-row dg-gen-row--data" class:is-off={!guesserInclude}>
          <div class="dg-gen-rowhead">
            <label class="dg-gen-check">
              <input type="checkbox" bind:checked={guesserInclude} />
              <span class="dg-gen-name">The Guesser</span>
              <span class="dg-gen-databadge">data</span>
            </label>
            <span
              class="dg-gen-cov {guesserAvailability === 'ready' ? 'dg-gen-cov--ok' : 'dg-gen-cov--warn'}"
              title={guesserAvailability === 'ready' ? 'A guesser with attempts was detected — the section will render' : 'No detected guesser / attempts this round — the section self-suppresses'}
            >{guesserAvailability === 'ready' ? '● coverage ready' : '⚠ no guesser detected'}</span>
          </div>
          <p class="dg-gen-note">
            Scores the round's who-submitted-what guesses from vote comments. Pure data —
            regenerate recomputes it from source; no LLM prompt. Opt-in per league.
          </p>
        </div>
      </div>

      <p class="dg-modal-hint">
        Unchecked sections are skipped. Style words + context steer each section. The full source data (votes, comments) is always passed alongside.
      </p>
    </div>

    <footer class="dg-modal-foot">
      <span class="cost">posts Generation params · regenerates the draft</span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit} disabled={busy || enabledCount === 0}>
          {busy ? '… generating' : recapEnabled ? '✎ Generate recap' : '✎ Generate'}
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .dg-genmodal {
    max-width: 600px;
  }
  .dg-modal-body {
    max-height: min(70vh, 720px);
    overflow: auto;
  }

  /* Season-recap mode sub-controls (sprint-21) — the wrapper/head/checkbox-label
     rules were removed once Task 3 merged this into a plain dg-gen-row; these
     remaining selectors still style the inline expanded controls. */
  .dg-recap-badge {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--mash-pulp);
    border: 1px solid var(--mash-pulp-edge, var(--mash-pulp));
    border-radius: 999px;
    padding: 3px 8px;
    white-space: nowrap;
  }
  .dg-recap-final {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    font: 600 12px/1 var(--font-body);
    color: var(--fg);
    white-space: nowrap;
  }
  .dg-recap-final input {
    accent-color: var(--mash-pulp);
    cursor: pointer;
  }
  .dg-recap-hint {
    font: 500 11px/1.4 var(--font-mono);
    color: var(--fg-quiet);
    flex: 1 1 200px;
    min-width: 0;
  }
  .dg-recap-note {
    margin: 8px 0 0;
    font: 500 11px/1.4 var(--font-mono);
    color: var(--fg-quiet);
  }

  .dg-gen-sections {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dg-gen-row {
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--ink-0);
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .dg-gen-row.is-off {
    opacity: 0.55;
  }
  .dg-gen-row--data {
    border-style: dashed;
    border-color: var(--line-strong);
  }
  .dg-gen-row--data .dg-gen-note {
    padding: 0 12px 10px;
    margin: 0;
  }
  .dg-gen-databadge {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--mash-pulp);
    border: 1px solid var(--mash-pulp-edge, var(--line-strong));
    border-radius: 999px;
    padding: 2px 6px;
  }
  .dg-gen-cov {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .dg-gen-cov--ok {
    color: #3ec27a;
  }
  .dg-gen-cov--warn {
    color: var(--mash-pulp, #e8a83a);
  }
  .dg-gen-recompute {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font: 600 11px/1 var(--font-mono);
    color: var(--fg-muted);
  }
  .dg-gen-recompute input {
    accent-color: var(--mash-pulp);
    cursor: pointer;
  }
  .dg-gen-rowhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    gap: 10px;
  }
  .dg-gen-check {
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    flex: 1;
  }
  .dg-gen-check input {
    width: 15px;
    height: 15px;
    accent-color: var(--mash-pulp);
    cursor: pointer;
  }
  .dg-gen-name {
    font: 600 13px/1.2 var(--font-body);
    color: var(--fg);
  }
  .dg-gen-rowmeta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dg-gen-count {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--mash-pulp);
    text-transform: uppercase;
  }
  .dg-gen-expand {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    color: var(--fg-muted);
    cursor: pointer;
    padding: 3px 8px;
    font: 700 11px/1 var(--font-mono);
  }
  .dg-gen-expand:hover { color: var(--fg); }
  .dg-gen-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 12px 12px;
    border-top: 1px solid var(--line);
  }
  .dg-gen-label {
    font: 700 9.5px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-muted);
    margin-top: 4px;
  }
  .dg-gen-context {
    min-height: 56px;
  }
  .dg-av-regen {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font: 600 12px/1.2 var(--font-body);
    color: var(--fg-muted);
    margin-top: 6px;
  }
  .dg-av-regen input {
    accent-color: var(--mash-pulp);
    cursor: pointer;
  }
  .dg-gen-note {
    margin: 0;
    font: 500 11px/1.4 var(--font-mono);
    color: var(--fg-quiet);
  }
  .dg-variant-pick {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .dg-vpk-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border-radius: var(--r-2);
    border: 1px solid var(--line-strong);
    background: var(--surface-2);
    color: var(--fg-2);
    font: 600 11px/1 var(--font-body);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }
  .dg-vpk-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--mash-pulp);
  }
  .dg-vpk-btn.is-on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
    border-color: var(--mash-pulp-edge);
  }
  .dg-vpk-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .dg-vpk-icon {
    font: 700 13px/1 var(--font-mono);
  }
  .dg-gen-subparts {
    margin: 6px 0 0;
    padding: 8px 0 2px 12px;
    border-left: 1px solid var(--line, #283039);
  }
  .dg-gen-subcheck { margin: 0; }
  .dg-gen-subnote { margin: 2px 0 8px 22px; opacity: 0.8; }
</style>
