<script lang="ts">
  import './models.css';
  import { onMount } from 'svelte';
  import {
    CAP_ORDER, CAP_META, effCost, qualifies, tierFromPricing,
    abbrOf, providerOf,
    type Model, type BucketState, type BucketReq,
  } from './qualify.js';
  import { DEFAULT_PIPELINE, type Pipeline, type Cover, type SectionKind } from '../digest/pipeline.js';
  import { solveClientEPs, type ClientEP } from './pipelineSolver.js';

  // ---- sprint-41 SectionState contract (mirrors Lane A API shape) -----------
  type SectionState = {
    key: string;              // "digest_model_<section>"
    section: string;          // e.g. "podium"
    label: string;            // human-readable display label
    bucket: 'predict' | 'digest';
    selected: string | null;  // DB-saved model_id; null = use default
    resolved: string;         // effective model: section pin ?? bucket ?? env ?? hardcoded
    requires: BucketReq;      // { json: true } for all sections in v1
  };

  // Ordered 16 section keys grouped by bucket (for mock fallback + grouping)
  const DIGEST_SECTION_KEYS = ['podium', 'villain', 'flow', 'consensus', 'quotes', 'chat'] as const;
  const PREDICT_SECTION_KEYS = [
    'narrative-player-superlatives', 'narrative-fan-hater-blurbs',
    'narrative-league-reel', 'narrative-moment-lines',
    'profile-spectrum', 'profile-playlist', 'season-update',
    'submission-predict', 'vote-probe', 'taste-fingerprint',
  ] as const;

  const SECTION_LABELS: Record<string, string> = {
    podium: 'Podium recap',
    villain: 'Villain section',
    flow: 'Flow commentary',
    consensus: 'Consensus picks',
    quotes: 'Notable quotes',
    chat: 'Chat highlights',
    'narrative-player-superlatives': 'Player superlatives',
    'narrative-fan-hater-blurbs': 'Fan / hater blurbs',
    'narrative-league-reel': 'League reel',
    'narrative-moment-lines': 'Moment lines',
    'profile-spectrum': 'Taste spectrum',
    'profile-playlist': 'Profile playlist',
    'season-update': 'Season update',
    'submission-predict': 'Submission predict',
    'vote-probe': 'Vote probe',
    'taste-fingerprint': 'Taste fingerprint',
  };

  function makeMockSection(section: string, bucket: 'predict' | 'digest'): SectionState {
    return {
      key: `digest_model_${section}`,
      section,
      label: SECTION_LABELS[section] ?? section,
      bucket,
      selected: null,
      resolved: '',
      requires: { json: true },
    };
  }

  function buildMockSections(): Record<string, SectionState> {
    const out: Record<string, SectionState> = {};
    for (const s of DIGEST_SECTION_KEYS) out[s] = makeMockSection(s, 'digest');
    for (const s of PREDICT_SECTION_KEYS) out[s] = makeMockSection(s, 'predict');
    return out;
  }

  // Draft superset — fields populated before saving to the roster.
  type Draft = {
    id: string | null;
    model_id: string;
    nickname: string;
    model_type: string;
    context_len: number | null;
    price_in: number | null;
    price_out: number | null;
    is_free: number;
    cost_override: string | null;
    cap_reason: number;
    cap_stream: number;
    cap_vision: number;
    cap_tools: number;
    cap_json: number;
    description: string;
    fabricated?: boolean;
  };

  // ---- state ----------------------------------------------------------------
  let sectionsData = $state<Record<string, SectionState>>({});
  let sectionsLoaded = $state(false);
  let sectionsMocked = $state(false);
  // accordion open state per bucket key (true = expanded)
  let digestOpen = $state(true);
  let predictOpen = $state(true);

  // ---- pipeline tab state --------------------------------------------------
  let activeTab = $state<'models' | 'pipeline'>('models');
  let pipelineMode = $state<'edit' | 'preview'>('edit');
  let workingCopy = $state<Pipeline>(structuredClone(DEFAULT_PIPELINE));
  let pipelineSaving = $state(false);
  let pipelineSaved = $state(false);

  let models = $state<Model[]>([]);
  let keyConfigured = $state(false);
  let keyVal = $state('');
  let showKey = $state(false);
  let savingKey = $state(false);

  let lookupQuery = $state('');
  let lookupStatus = $state<'idle' | 'loading' | 'done' | 'notfound' | 'error'>('idle');
  let draft = $state<Draft | null>(null);

  let predictBucket = $state<BucketState>({
    key: 'predict', selected: null, envValue: null,
    hardcoded: 'anthropic/claude-sonnet-4-5', resolved: null,
    requires: { json: true }, recommend: 'A model with JSON output for structured scoring.',
    usedBy: ['theme-fit', 'chat-parse', 'vibe'],
  });
  let digestBucket = $state<BucketState>({
    key: 'digest', selected: null, envValue: null,
    hardcoded: 'anthropic/claude-sonnet-4-5', resolved: null,
    requires: { json: true }, recommend: 'A capable model for tone-sensitive prose generation.',
    usedBy: ['digest'],
  });

  // ---- derived --------------------------------------------------------------
  const sorted = $derived([...models].sort((a, b) => b.favorite - a.favorite));

  // Per-section derived — sections grouped and sorted per spec
  const digestSections = $derived(
    DIGEST_SECTION_KEYS
      .map((k) => sectionsData[k])
      .filter(Boolean)
  );
  const predictSections = $derived(
    PREDICT_SECTION_KEYS
      .map((k) => sectionsData[k])
      .filter(Boolean)
  );

  const digestOverrideCount = $derived(digestSections.filter((s) => s.selected != null).length);
  const predictOverrideCount = $derived(predictSections.filter((s) => s.selected != null).length);

  function qualifying(req: BucketReq): Model[] {
    return sorted.filter((m) => qualifies(m, req));
  }

  // price_in/price_out are stored per-token; tierFromPricing expects per-million.
  function costTierOf(m: Model): string | null {
    return m.cost_override ?? tierFromPricing(
      m.price_in != null ? m.price_in * 1e6 : null,
      m.price_out != null ? m.price_out * 1e6 : null,
    );
  }

  function tierNum(m: Model): number {
    const t = costTierOf(m);
    if (!t) return 0;
    return ({ '$': 1, '$$': 2, '$$$': 3 } as Record<string, number>)[t] ?? 3;
  }

  // ---- API helpers ----------------------------------------------------------
  async function loadModels() {
    try {
      const r = await fetch('/api/models');
      if (r.ok) models = await r.json();
    } catch { /* backend not ready */ }
  }

  async function loadKeyStatus() {
    try {
      const r = await fetch('/api/settings/openrouter-key');
      if (r.ok) {
        const d = await r.json();
        keyConfigured = !!d.configured;
      }
    } catch { /* backend not ready */ }
  }

  async function loadModelVars() {
    try {
      const r = await fetch('/api/model-vars');
      if (r.ok) {
        const d: { predict: BucketState; digest: BucketState } = await r.json();
        predictBucket = d.predict;
        digestBucket = d.digest;
      }
    } catch { /* backend not ready */ }
  }

  async function loadSections() {
    try {
      const r = await fetch('/api/model-vars/sections');
      if (r.ok) {
        sectionsData = await r.json();
        sectionsLoaded = true;
        sectionsMocked = false;
      } else if (r.status === 404) {
        // Lane A endpoint not yet shipped — use local mock so UI renders
        sectionsData = buildMockSections();
        sectionsLoaded = true;
        sectionsMocked = true;
      }
    } catch {
      // Backend not ready — mock so panel still renders
      sectionsData = buildMockSections();
      sectionsLoaded = true;
      sectionsMocked = true;
    }
  }

  onMount(() => {
    loadModels();
    loadKeyStatus();
    loadModelVars();
    loadSections();
    loadPipeline();
  });

  // ---- key management -------------------------------------------------------
  async function saveKey() {
    if (!keyVal.trim()) return;
    savingKey = true;
    try {
      const r = await fetch('/api/settings/openrouter-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyVal.trim() }),
      });
      if (r.ok) {
        keyConfigured = true;
        keyVal = '';
        showKey = false;
      }
    } finally {
      savingKey = false;
    }
  }

  // ---- lookup + draft -------------------------------------------------------
  async function runLookup() {
    const q = lookupQuery.trim();
    if (!q) return;
    lookupStatus = 'loading';
    draft = null;
    try {
      const r = await fetch(`/api/models/lookup?id=${encodeURIComponent(q)}`);
      if (r.ok) {
        const d = await r.json();
        if (!d.found && !d.estimated) {
          lookupStatus = 'notfound';
        } else {
          lookupStatus = 'done';
          const m: Partial<Model> & { fabricated?: boolean } = d.draft ?? {};
          draft = {
            id: null,
            model_id: m.model_id ?? q,
            nickname: m.nickname ?? q.split('/')[1]?.replace(/[-_:]/g, ' ') ?? q,
            model_type: m.model_type ?? 'general',
            context_len: m.context_len ?? null,
            price_in: m.price_in ?? null,
            price_out: m.price_out ?? null,
            is_free: m.is_free ?? 0,
            cost_override: m.cost_override ?? null,
            cap_reason: m.cap_reason ?? 0,
            cap_stream: m.cap_stream ?? 1,
            cap_vision: m.cap_vision ?? 0,
            cap_tools: m.cap_tools ?? 1,
            cap_json: m.cap_json ?? 1,
            description: m.description ?? '',
            fabricated: d.estimated ?? false,
          };
        }
      } else if (r.status === 404) {
        lookupStatus = 'notfound';
      } else {
        lookupStatus = 'error';
      }
    } catch {
      lookupStatus = 'error';
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const { id, fabricated, ...body } = draft;
    const existing = models.find((m) => m.model_id === draft!.model_id);
    let r: Response;
    if (existing) {
      r = await fetch(`/api/models/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      r = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    if (r.ok) {
      await loadModels();
      cancelDraft();
    }
  }

  function cancelDraft() {
    draft = null;
    lookupQuery = '';
    lookupStatus = 'idle';
  }

  function editModel(m: Model) {
    lookupQuery = m.model_id;
    lookupStatus = 'done';
    draft = {
      id: m.id,
      model_id: m.model_id,
      nickname: m.nickname,
      model_type: m.model_type,
      context_len: m.context_len,
      price_in: m.price_in,
      price_out: m.price_out,
      is_free: m.is_free,
      cost_override: m.cost_override,
      cap_reason: m.cap_reason,
      cap_stream: m.cap_stream,
      cap_vision: m.cap_vision,
      cap_tools: m.cap_tools,
      cap_json: m.cap_json,
      description: m.description,
    };
  }

  async function toggleFav(m: Model) {
    const r = await fetch(`/api/models/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: m.favorite ? 0 : 1 }),
    });
    if (r.ok) await loadModels();
  }

  async function removeModel(m: Model) {
    const r = await fetch(`/api/models/${m.id}`, { method: 'DELETE' });
    if (r.ok) await loadModels();
  }

  // ---- bucket select --------------------------------------------------------
  async function setBucket(bucketKey: 'predict' | 'digest', modelId: string) {
    const r = await fetch(`/api/model-vars/${bucketKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId }),
    });
    if (r.ok) {
      const updated: BucketState = await r.json();
      if (bucketKey === 'predict') predictBucket = updated;
      else digestBucket = updated;
    }
  }

  function bucketWarn(b: BucketState): boolean {
    return !!b.selected && !!b.envValue && b.selected !== b.envValue;
  }

  // ---- per-section select ---------------------------------------------------
  async function setSectionModel(section: string, modelId: string | null) {
    // Optimistic update
    const prev = sectionsData[section];
    if (!prev) return;
    sectionsData = {
      ...sectionsData,
      [section]: { ...prev, selected: modelId },
    };
    try {
      const r = await fetch(`/api/model-vars/sections/${encodeURIComponent(section)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId }),
      });
      if (r.ok) {
        const updated: SectionState = await r.json();
        sectionsData = { ...sectionsData, [section]: updated };
      } else {
        // Rollback optimistic update on error
        sectionsData = { ...sectionsData, [section]: prev };
      }
    } catch {
      // Rollback optimistic update on network error
      sectionsData = { ...sectionsData, [section]: prev };
    }
  }

  function toggleDraftCap(c: (typeof CAP_ORDER)[number]) {
    if (!draft) return;
    const key = `cap_${c}` as keyof Draft;
    const cur = draft[key] as number;
    draft = { ...draft, [key]: cur ? 0 : 1 };
  }

  // ---- pipeline API -------------------------------------------------------
  async function loadPipeline() {
    try {
      const r = await fetch('/api/settings/pipeline-config');
      if (r.ok) {
        const d = await r.json();
        workingCopy = d.pipeline;
      }
    } catch { /* backend not ready */ }
  }

  async function savePipeline() {
    pipelineSaving = true;
    pipelineSaved = false;
    try {
      const r = await fetch('/api/settings/pipeline-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline: workingCopy }),
      });
      if (r.ok) {
        const d = await r.json();
        workingCopy = d.pipeline;
        pipelineSaved = true;
        setTimeout(() => { pipelineSaved = false; }, 2000);
      }
    } finally {
      pipelineSaving = false;
    }
  }

  async function resetPipeline() {
    pipelineSaving = true;
    try {
      const r = await fetch('/api/settings/pipeline-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline: DEFAULT_PIPELINE }),
      });
      if (r.ok) {
        const d = await r.json();
        workingCopy = d.pipeline;
      }
    } finally {
      pipelineSaving = false;
    }
  }

  // ---- pipeline editor mutations ------------------------------------------
  function moveSection(idx: number, dir: -1 | 1) {
    const newOrder = [...workingCopy.order];
    const swap = idx + dir;
    [newOrder[idx], newOrder[swap]] = [newOrder[swap], newOrder[idx]];
    workingCopy = { ...workingCopy, order: newOrder };
  }

  function setSectionPipelineModel(sec: string, modelId: string) {
    const newModels = { ...(workingCopy.models as Record<string, string>) };
    if (modelId === '__default__') {
      delete newModels[sec];
    } else {
      newModels[sec] = modelId;
    }
    workingCopy = { ...workingCopy, models: newModels as typeof workingCopy.models };
  }

  function toggleSkip(sec: string) {
    const newSkip = { ...(workingCopy.skipAfter as Record<string, true>) };
    if (newSkip[sec]) {
      delete newSkip[sec];
    } else {
      newSkip[sec] = true;
    }
    workingCopy = { ...workingCopy, skipAfter: newSkip as typeof workingCopy.skipAfter };
  }

  function addCover(sec: string) {
    const defaultCoverModel = qualifying({ json: true })[0]?.model_id ?? '';
    workingCopy = {
      ...workingCopy,
      covers: [...workingCopy.covers, { of: sec as SectionKind, model: defaultCoverModel }],
    };
  }

  function removeCover(sec: string) {
    workingCopy = {
      ...workingCopy,
      covers: workingCopy.covers.filter((c) => c.of !== sec),
    };
  }

  function setCoverModel(sec: string, modelId: string) {
    workingCopy = {
      ...workingCopy,
      covers: workingCopy.covers.map((c) => (c.of === sec ? { ...c, model: modelId } : c)),
    };
  }

  // ---- pipeline derived values -------------------------------------------
  const clientEPs: ClientEP[] = $derived(
    solveClientEPs(workingCopy, workingCopy.order, digestBucket.resolved ?? digestBucket.hardcoded),
  );

  const mergeMap = $derived((() => {
    const map = new Map<string, { inGroup: boolean; isFirst: boolean; groupSize: number }>();
    for (const ep of clientEPs) {
      for (const group of ep.groups) {
        for (let i = 0; i < group.sections.length; i++) {
          map.set(group.sections[i], {
            inGroup: group.sections.length > 1,
            isFirst: i === 0,
            groupSize: group.sections.length,
          });
        }
      }
    }
    return map;
  })());

  const callCount = $derived(
    clientEPs.reduce((n, ep) => n + ep.groups.length + ep.covers.length, 0),
  );

  const costBand = $derived((() => {
    const eligible = qualifying({ json: true });
    const modelMap = new Map(eligible.map((m) => [m.model_id, m]));
    let hasExpensive = false;
    let allCheap = true;
    let anyResolved = false;
    for (const ep of clientEPs) {
      for (const group of ep.groups) {
        const m = modelMap.get(group.model);
        if (m) {
          anyResolved = true;
          const t = tierNum(m);
          if (t >= 3) hasExpensive = true;
          if (t !== 1) allCheap = false;
        } else {
          allCheap = false;
        }
      }
    }
    if (!anyResolved) return '';
    if (hasExpensive) return '$$$';
    if (allCheap) return '$';
    return '$$';
  })());
</script>

<div class="mlm-screen">

  <!-- page head -->
  <header style="display:flex;flex-direction:column;gap:4px;margin-bottom:4px;">
    <p class="t-eyebrow">Models &amp; AI · OpenRouter</p>
    <h1 style="margin:0;font:700 32px/1.15 var(--font-display);letter-spacing:-0.015em;color:var(--fg);">Models</h1>
    <p style="margin:0;font:400 14px/1.5 var(--font-body);color:var(--fg-muted);max-width:64ch;">
      One OpenRouter key, a saved roster of models, and two model variables — Predict and Digest — that drive every AI job the bot runs.
    </p>
  </header>

  <!-- ===== In-page tab strip ===== -->
  <div class="mlm-tab-strip" role="tablist">
    <button
      role="tab"
      class="mlm-tab {activeTab === 'models' ? 'is-active' : ''}"
      aria-selected={activeTab === 'models'}
      onclick={() => (activeTab = 'models')}
    >Models</button>
    <button
      role="tab"
      class="mlm-tab {activeTab === 'pipeline' ? 'is-active' : ''}"
      aria-selected={activeTab === 'pipeline'}
      onclick={() => (activeTab = 'pipeline')}
    >Pipeline</button>
  </div>

{#if activeTab === 'models'}
  <!-- ===== OpenRouter connection card ===== -->
  <article class="ml-card">
    <header class="ml-card-head">
      <div>
        <h3 class="ml-card-title">OpenRouter connection</h3>
        <p class="ml-card-sub">Every AI task routes through this one key. Stored server-side, never in the chat ingest.</p>
      </div>
      <span class="mlm-status {keyConfigured ? 'mlm-status--ok' : 'mlm-status--need'}">
        <span class="mlm-status-dot"></span>
        {keyConfigured ? 'Configured' : 'Required'}
      </span>
    </header>

    <div class="mlm-keybar">
      <div class="mlm-field">
        <label for="mlm-key">API key</label>
        <div class="mlm-key-field">
          <input
            id="mlm-key"
            class="ml-input"
            type={showKey ? 'text' : 'password'}
            bind:value={keyVal}
            placeholder="sk-or-v1-…"
          />
          <button
            class="mlm-reveal"
            onclick={() => (showKey = !showKey)}
            title={showKey ? 'Hide' : 'Reveal'}
          >{showKey ? 'hide' : 'show'}</button>
        </div>
        <p class="mlm-field-hint">Get a key at openrouter.ai/keys</p>
        {#if keyVal.trim()}
          <div style="margin-top:4px;">
            <button
              class="mash-btn mash-btn--primary mash-btn--sm"
              onclick={saveKey}
              disabled={savingKey}
            >{savingKey ? 'Saving…' : 'Save key'}</button>
          </div>
        {/if}
      </div>

      <div class="mlm-field">
        <label>Status</label>
        <p style="margin:0;font:400 13px/1.45 var(--font-body);color:var(--fg-muted);">
          {keyConfigured
            ? 'Key saved. To update, paste a new key on the left.'
            : 'No key set. Paste your OpenRouter key to enable AI features.'}
        </p>
      </div>
    </div>
  </article>

  <!-- ===== Saved models card ===== -->
  <article class="ml-card">
    <header class="ml-card-head">
      <div>
        <h3 class="ml-card-title">
          Saved models
          <span style="color:var(--fg-quiet);font-weight:500;"> · {models.length}</span>
        </h3>
        <p class="ml-card-sub">The roster. Star a model to float it to the top of every picker.</p>
      </div>
    </header>

    {#if sorted.length > 0}
      <div class="mlm-list">
        <div class="mlm-list-head">
          <span></span>
          <span></span>
          <span>Model</span>
          <span>Capabilities</span>
          <span>Cost</span>
          <span></span>
        </div>
        {#each sorted as m (m.id)}
          {@const t = tierNum(m)}
          <div class="mlm-row">
            <button
              class="mlm-star {m.favorite ? 'is-on' : ''}"
              onclick={() => toggleFav(m)}
              title={m.favorite ? 'Unstar' : 'Star'}
            >{m.favorite ? '★' : '☆'}</button>

            <span class="mlm-prov" title={providerOf(m.model_id)}>{abbrOf(m.model_id)}</span>

            <div class="mlm-name-block">
              <div class="mlm-name-row">
                <span class="mlm-name">{m.nickname}</span>
                <span class="mlm-type">{m.model_type}</span>
              </div>
              <div class="mlm-id-row">
                <span class="mlm-id">{m.model_id}</span>
                {#if m.context_len}
                  <span class="mlm-ctx">{Math.round(m.context_len / 1000)}k ctx</span>
                {/if}
              </div>
            </div>

            <span class="mlm-caps">
              {#each CAP_ORDER as c}
                {@const on = !!(m[`cap_${c}` as keyof Model] as number)}
                <span class="mlm-cap {on ? '' : 'is-off'}" title={CAP_META[c].label}>
                  {CAP_META[c].g}
                </span>
              {/each}
            </span>

            {#if m.is_free}
              <span class="mlm-cost-cell"><span class="mlm-free">FREE</span></span>
            {:else if t > 0}
              <span class="mlm-cost-cell">
                <span class="mlm-cost mlm-cost--{t}" title="{'$'.repeat(t)} cost tier">
                  {'$'.repeat(t)}
                </span>
              </span>
            {:else}
              <span class="mlm-cost-cell" style="color:var(--fg-quiet);">—</span>
            {/if}

            <div class="mlm-row-actions">
              <button class="ml-icon-btn" title="Edit" onclick={() => editModel(m)}>✎</button>
              <button
                class="ml-icon-btn"
                title="Remove"
                style="color:var(--ember);"
                onclick={() => removeModel(m)}
              >×</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p style="margin:0;font:500 13px/1.45 var(--font-mono);color:var(--fg-quiet);">
        No models saved yet. Paste an OpenRouter id below to add one.
      </p>
    {/if}

    <!-- lookup / add panel -->
    <div class="mlm-add {draft ? 'is-resolved' : ''}">
      <div class="mlm-field">
        <label for="mlm-lookup">Add a model — paste its OpenRouter id</label>
        <div class="mlm-lookup-row">
          <input
            id="mlm-lookup"
            class="ml-input"
            bind:value={lookupQuery}
            oninput={() => { if (lookupStatus === 'notfound' || lookupStatus === 'error') lookupStatus = 'idle'; }}
            onkeydown={(e) => { if (e.key === 'Enter') runLookup(); }}
            placeholder="anthropic/claude-sonnet-4"
          />
          <button
            class="mash-btn mash-btn--secondary"
            onclick={runLookup}
            disabled={lookupStatus === 'loading' || !lookupQuery.trim()}
          >
            {#if lookupStatus === 'loading'}
              <span class="mlm-spin"></span> Looking up
            {:else}
              Look up ↻
            {/if}
          </button>
        </div>
        {#if lookupStatus === 'notfound'}
          <p class="mlm-lookup-err">No model with that id. Check it against openrouter.ai/models.</p>
        {:else if lookupStatus === 'error'}
          <p class="mlm-lookup-err">Lookup failed — is the backend running?</p>
        {:else}
          <p class="mlm-field-hint">Pulls spec, context window, and pricing from the OpenRouter models API.</p>
        {/if}
      </div>

      {#if draft}
        <div class="mlm-autofill">
          <div class="mlm-resolved-bar">
            <span class="mlm-status mlm-status--ok">
              <span class="mlm-status-dot"></span>Resolved
            </span>
            <span class="mlm-resolved-tag">
              <b>{providerOf(draft.model_id)}</b>
              {#if draft.context_len} · {Math.round(draft.context_len / 1000)}k context{/if}
            </span>
            {#if draft.is_free}
              <span class="mlm-resolved-tag"><b>free tier</b></span>
            {:else if draft.price_in != null}
              {@const tier = tierFromPricing(draft.price_in * 1e6, draft.price_out != null ? draft.price_out * 1e6 : null)}
              <span class="mlm-resolved-tag">
                ${(draft.price_in * 1e6).toFixed(2)}/M in · ${draft.price_out != null ? (draft.price_out * 1e6).toFixed(2) : '?'}/M out{tier ? ` → ` : ''}{#if tier}<b>{tier}</b>{/if}
              </span>
            {/if}
            {#if draft.fabricated}
              <span class="mlm-resolved-tag" style="color:var(--amber);">· estimated (id not in catalog)</span>
            {/if}
          </div>

          <div class="mlm-field">
            <label>Nickname</label>
            <input
              class="ml-input"
              style="font-family:var(--font-body);font-size:13px;"
              bind:value={draft.nickname}
            />
          </div>

          <div class="mlm-field">
            <label>Type</label>
            <select class="mlm-select" bind:value={draft.model_type}>
              <option value="general">general</option>
              <option value="reasoning">reasoning</option>
              <option value="coding">coding</option>
              <option value="image">image</option>
            </select>
          </div>

          <div class="mlm-field mlm-field-full">
            <label>Capabilities (auto-detected — toggle to correct)</label>
            <div class="mlm-caps" style="gap:8px;">
              {#each CAP_ORDER as c}
                {@const on = !!(draft[`cap_${c}` as keyof Draft] as number)}
                <button
                  class="mlm-cap {on ? '' : 'is-off'}"
                  style="width:auto;padding:0 9px;height:26px;gap:6px;display:inline-flex;cursor:pointer;"
                  onclick={() => toggleDraftCap(c)}
                  title={CAP_META[c].label}
                >
                  <span>{CAP_META[c].g}</span>
                  <span style="font-size:10px;letter-spacing:0.04em;">{CAP_META[c].short}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="ml-btn-row mlm-field-full" style="margin-top:2px;">
            <button class="mash-btn mash-btn--primary" onclick={saveDraft}>Save model</button>
            <button class="mash-btn mash-btn--ghost" onclick={cancelDraft}>Cancel</button>
          </div>
        </div>
      {/if}
    </div>
  </article>

  <!-- ===== Model Variables card ===== -->
  <article class="ml-card ml-card--accent">
    <header class="ml-card-head">
      <div>
        <h3 class="ml-card-title">Model Variables</h3>
        <p class="ml-card-sub">
          Choose which saved model runs each AI bucket. DB setting overrides the env var, which overrides the hardcoded fallback.
          Change a model's capabilities in the roster above and the selects re-filter instantly.
        </p>
      </div>
    </header>

    <div class="mlm-vars">
      {#each (
        [
          { label: 'Predict', bkey: 'predict' as const, bucket: predictBucket },
          { label: 'Digest',  bkey: 'digest'  as const, bucket: digestBucket },
        ] as { label: string; bkey: 'predict' | 'digest'; bucket: BucketState }[]
      ) as row (row.bkey)}
        {@const eligible = qualifying(row.bucket.requires)}
        {@const currentOk = eligible.some((m) => m.model_id === row.bucket.selected)}
        <div class="mlm-bucket">
          <div class="mlm-bucket-label">
            {row.label}
            <span class="mlm-bucket-key">{row.bkey}</span>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span style="font:700 9px/1 var(--font-body);letter-spacing:0.07em;text-transform:uppercase;color:var(--fg-quiet);margin-right:2px;">requires</span>
            {#each CAP_ORDER.filter((c) => !!(row.bucket.requires as Record<string, unknown>)[c]) as c}
              <span class="ml-chip ml-chip--sky">{CAP_META[c].g} {CAP_META[c].short}</span>
            {/each}
          </div>

          <select
            class="mlm-select"
            value={currentOk ? (row.bucket.selected ?? '') : ''}
            onchange={(e) => setBucket(row.bkey, (e.target as HTMLSelectElement).value)}
          >
            {#if !currentOk || !row.bucket.selected}
              <option value="" disabled>Pick a qualifying model…</option>
            {/if}
            {#each eligible as m (m.id)}
              {@const t = tierNum(m)}
              <option value={m.model_id}>
                {m.nickname}{m.is_free ? ' · free' : ' · ' + '$'.repeat(t || 1)}
              </option>
            {/each}
          </select>

          <span class="mlm-qual {eligible.length ? '' : 'is-none'}">
            <b>{eligible.length}</b> of {models.length} models qualify
          </span>

          {#if row.bucket.usedBy.length}
            <p style="margin:0;font:500 11px/1 var(--font-mono);color:var(--fg-quiet);">
              Used by: {row.bucket.usedBy.join(', ')}
            </p>
          {/if}

          {#if row.bucket.recommend}
            <p style="margin:0;font:400 11.5px/1.4 var(--font-mono);color:var(--fg-quiet);">
              {row.bucket.recommend}
            </p>
          {/if}

          {#if bucketWarn(row.bucket)}
            <div class="mlm-warn">
              DB override active — env var is <b style="margin:0 3px;">{row.bucket.envValue}</b> but DB takes precedence.
            </div>
          {/if}
        </div>
      {/each}

      <!-- fallback chain read-only display -->
      <div class="mlm-fallback">
        <div class="mlm-fallback-label">Fallback chain (read-only)</div>
        <div class="mlm-fallback-row">
          <div class="mlm-fallback-field">
            <label>Predict env var</label>
            <div class="mlm-ro-value {predictBucket.envValue ? '' : 'is-none'}">
              {predictBucket.envValue ?? 'not set'}
            </div>
          </div>
          <div class="mlm-fallback-field">
            <label>Digest env var</label>
            <div class="mlm-ro-value {digestBucket.envValue ? '' : 'is-none'}">
              {digestBucket.envValue ?? 'not set'}
            </div>
          </div>
          <div class="mlm-fallback-field">
            <label>Hardcoded default</label>
            <div class="mlm-ro-value">{predictBucket.hardcoded}</div>
          </div>
        </div>
      </div>
    </div>
  </article>

  <!-- ===== Per-section overrides card (Q3: read-only mirror) ===== -->
  {#if sectionsLoaded && models.length >= 1}
    <article class="ml-card mlm-sections-card">
      <header class="ml-card-head">
        <div>
          <h3 class="ml-card-title">Per-section overrides</h3>
          <p class="ml-card-sub">
            Per-section models are now set in the Pipeline tab. These values show the currently effective model per section.
          </p>
          <p style="margin:4px 0 0;font:400 13px/1.45 var(--font-body);">
            <button class="mlm-link-btn" onclick={() => (activeTab = 'pipeline')}>Go to Pipeline tab</button>
          </p>
        </div>
      </header>

      <!-- Digest sections bucket -->
      <div class="mlm-section-group">
        <button
          class="mlm-section-group-head"
          onclick={() => (digestOpen = !digestOpen)}
          aria-expanded={digestOpen}
        >
          <span class="mlm-section-group-label">Digest sections</span>
          <span class="mlm-section-group-badge" style="display:flex;align-items:center;gap:8px;">
            <span class="mlm-section-chevron" class:is-open={digestOpen}>&#8250;</span>
          </span>
        </button>

        {#if digestOpen}
          <div class="mlm-section-rows">
            {#each digestSections as s (s.section)}
              {@const eligible = qualifying(s.requires)}
              {@const pinSet = s.selected != null}
              <div class="mlm-section-row">
                <span class="mlm-section-label">{s.label}</span>
                <select
                  class="mlm-select mlm-section-select"
                  value={s.selected ?? '__default__'}
                  disabled
                >
                  <option value="__default__">(use default)</option>
                  {#each eligible as m (m.id)}
                    <option value={m.model_id}>{m.nickname}</option>
                  {/each}
                </select>
                {#if pinSet}
                  <span class="mlm-section-resolved">
                    &#10140; {s.resolved || s.selected}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Dashboard & predict tasks bucket -->
      <div class="mlm-section-group">
        <button
          class="mlm-section-group-head"
          onclick={() => (predictOpen = !predictOpen)}
          aria-expanded={predictOpen}
        >
          <span class="mlm-section-group-label">Dashboard &amp; predict tasks</span>
          <span class="mlm-section-group-badge" style="display:flex;align-items:center;gap:8px;">
            <span class="mlm-section-chevron" class:is-open={predictOpen}>&#8250;</span>
          </span>
        </button>

        {#if predictOpen}
          <div class="mlm-section-rows">
            {#each predictSections as s (s.section)}
              {@const eligible = qualifying(s.requires)}
              {@const pinSet = s.selected != null}
              <div class="mlm-section-row">
                <span class="mlm-section-label">{s.label}</span>
                <select
                  class="mlm-select mlm-section-select"
                  value={s.selected ?? '__default__'}
                  disabled
                >
                  <option value="__default__">(use default)</option>
                  {#each eligible as m (m.id)}
                    <option value={m.model_id}>{m.nickname}</option>
                  {/each}
                </select>
                {#if pinSet}
                  <span class="mlm-section-resolved">
                    &#10140; {s.resolved || s.selected}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </article>
  {/if}

{/if}

{#if activeTab === 'pipeline'}
  <div class="mlm-pipeline">

    <!-- Edit / Preview sub-tabs -->
    <div class="mlm-sub-tabs" role="tablist">
      <button
        role="tab"
        class="mlm-sub-tab {pipelineMode === 'edit' ? 'is-active' : ''}"
        aria-selected={pipelineMode === 'edit'}
        onclick={() => (pipelineMode = 'edit')}
      >Edit</button>
      <button
        role="tab"
        class="mlm-sub-tab {pipelineMode === 'preview' ? 'is-active' : ''}"
        aria-selected={pipelineMode === 'preview'}
        onclick={() => (pipelineMode = 'preview')}
      >Preview</button>
    </div>

    {#if pipelineMode === 'edit'}
      <!-- Two-pane (Option C): editor left, run preview right on desktop -->
      <div class="mlm-pipeline-panes">

        <!-- Left: flat track list editor (Option A) -->
        <div class="mlm-track-list">
          {#each workingCopy.order as sec, idx (sec)}
            {@const mi = mergeMap.get(sec)}
            {@const hasCover = workingCopy.covers.some((c) => c.of === sec)}
            {@const coverEntry = workingCopy.covers.find((c) => c.of === sec)}
            {@const hasSkip = !!(workingCopy.skipAfter as Record<string, boolean>)[sec]}
            {@const eligible = qualifying({ json: true })}

            <div class="mlm-track-item {mi?.inGroup ? 'has-rail' : ''}">
              <div class="mlm-track-row">
                <!-- reorder -->
                <div class="mlm-reorder-btns">
                  <button
                    class="ml-icon-btn mlm-reorder-btn"
                    disabled={idx === 0}
                    onclick={() => moveSection(idx, -1)}
                    title="Move up"
                  >▲</button>
                  <button
                    class="ml-icon-btn mlm-reorder-btn"
                    disabled={idx === workingCopy.order.length - 1}
                    onclick={() => moveSection(idx, 1)}
                    title="Move down"
                  >▼</button>
                </div>

                <!-- section label + merge badge -->
                <div class="mlm-track-name-col">
                  <span class="mlm-track-label">{SECTION_LABELS[sec] ?? sec}</span>
                  {#if mi?.isFirst && (mi?.groupSize ?? 1) > 1}
                    <span class="mlm-merge-badge">merge x{mi.groupSize}</span>
                  {/if}
                </div>

                <!-- per-section model select -->
                <select
                  class="mlm-select mlm-track-model"
                  value={(workingCopy.models as Record<string, string>)[sec] ?? '__default__'}
                  onchange={(e) => setSectionPipelineModel(sec, (e.target as HTMLSelectElement).value)}
                >
                  <option value="__default__">Use default · {digestBucket.resolved ?? digestBucket.hardcoded}</option>
                  {#each eligible as m (m.id)}
                    <option value={m.model_id}>{m.nickname}</option>
                  {/each}
                </select>

                <!-- skip toggle -->
                <button
                  class="mlm-skip-toggle {hasSkip ? 'is-active' : ''}"
                  onclick={() => toggleSkip(sec)}
                  title={hasSkip ? 'Remove skip after this section' : 'Add skip after this section'}
                >{hasSkip ? '- skip' : '+ skip'}</button>
              </div>

              <!-- cover sub-row (dashed, indented) -->
              {#if hasCover && coverEntry}
                <div class="mlm-cover-row">
                  <span class="mlm-cover-glyph">&#10551;</span>
                  <span class="mlm-cover-label">cover of {SECTION_LABELS[sec] ?? sec}</span>
                  <select
                    class="mlm-select mlm-cover-model"
                    value={coverEntry.model}
                    onchange={(e) => setCoverModel(sec, (e.target as HTMLSelectElement).value)}
                  >
                    {#each eligible as m (m.id)}
                      <option value={m.model_id}>{m.nickname}</option>
                    {/each}
                  </select>
                  <button class="ml-icon-btn" onclick={() => removeCover(sec)} title="Remove cover">×</button>
                </div>
              {:else}
                <div class="mlm-cover-add-row">
                  <button class="mlm-cover-add" onclick={() => addCover(sec)}>+ cover</button>
                  <span class="mlm-cover-hint">produces two takes you'll pick between</span>
                </div>
              {/if}

              <!-- skip divider (shown after track row when skipAfter is set) -->
              {#if hasSkip}
                <div class="mlm-skip-div">── skip ──</div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Right: run preview EP timeline (desktop only via CSS) -->
        <div class="mlm-run-preview">
          <div class="mlm-preview-head">Run preview</div>
          {#each clientEPs as ep, i}
            {#if i > 0}
              <div class="mlm-preview-skip">── skip ──</div>
            {/if}
            <div class="mlm-preview-ep">
              <div class="mlm-preview-ep-label">EP {i}</div>
              {#each ep.groups as g}
                <div class="mlm-preview-group">
                  <span class="mlm-preview-model">{g.model.split('/')[1] ?? g.model}</span>
                  <span class="mlm-preview-secs">{g.sections.map((s) => SECTION_LABELS[s] ?? s).join(', ')}</span>
                </div>
              {/each}
              {#each ep.covers as cv}
                <div class="mlm-preview-cover-row">
                  <span class="mlm-cover-glyph">&#10551;</span>
                  <span>{SECTION_LABELS[cv.of] ?? cv.of} cover</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>

      </div>

    {:else}
      <!-- Preview mode: Option B EP cards -->
      <div class="mlm-ep-cards">
        {#each clientEPs as ep, i}
          {#if i > 0}
            <div class="mlm-skip-div">── skip ──</div>
          {/if}
          <div class="mlm-ep-card">
            <div class="mlm-ep-card-label">EP {i}</div>
            {#each ep.groups as g}
              <div class="mlm-ep-group">
                <span class="mlm-preview-model">{g.model.split('/')[1] ?? g.model}</span>
                <div class="mlm-ep-group-chips">
                  {#each g.sections as s}
                    <span class="ml-chip">{SECTION_LABELS[s] ?? s}</span>
                  {/each}
                </div>
              </div>
            {/each}
            {#each ep.covers as cv}
              <div class="mlm-preview-cover-row">
                <span class="mlm-cover-glyph">&#10551;</span>
                <span>{SECTION_LABELS[cv.of] ?? cv.of} cover · {cv.model.split('/')[1] ?? cv.model}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Pipeline footer: cost band + save/reset -->
    <div class="mlm-pipeline-footer">
      <div class="mlm-cost-band">
        approx {callCount} calls{costBand ? ' · ' + costBand : ''}
      </div>
      <div class="ml-btn-row">
        <button
          class="mash-btn mash-btn--primary"
          onclick={savePipeline}
          disabled={pipelineSaving}
        >{pipelineSaving ? 'Saving...' : pipelineSaved ? 'Saved ✓' : 'Save'}</button>
        <button
          class="mash-btn mash-btn--ghost"
          onclick={resetPipeline}
          disabled={pipelineSaving}
        >Reset to default</button>
      </div>
    </div>

  </div>
{/if}

</div>

<style>
  .mlm-screen {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* ===== per-section overrides card ======================================= */
  .mlm-sections-card { border-left: 3px solid var(--amber); }

  .mlm-section-group {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    overflow: hidden;
  }

  .mlm-section-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    background: var(--surface-2);
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background var(--dur-fast) var(--ease-out);
  }
  .mlm-section-group-head:hover { background: var(--surface-hover); }

  .mlm-section-group-label {
    font: 700 11px/1 var(--font-body);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .mlm-section-group-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .mlm-section-chevron {
    font: 600 16px/1 var(--font-body);
    color: var(--fg-quiet);
    display: inline-block;
    transform: rotate(90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .mlm-section-chevron.is-open { transform: rotate(270deg); }

  .mlm-section-rows {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }

  .mlm-section-row {
    display: grid;
    grid-template-columns: minmax(130px, 1.2fr) minmax(0, 2fr);
    gap: 10px;
    align-items: start;
    padding: 9px 14px;
    border-bottom: 1px solid var(--line);
    transition: background var(--dur-fast) var(--ease-out);
  }
  .mlm-section-row:last-child { border-bottom: none; }
  .mlm-section-row:hover { background: var(--surface-hover); }

  .mlm-section-label {
    font: 500 12px/1.35 var(--font-body);
    color: var(--fg-muted);
    padding-top: 10px; /* align vertically with select */
    min-width: 0;
  }

  .mlm-section-select {
    /* Use the existing .mlm-select base; just constrain height */
    min-width: 0;
  }

  .mlm-section-resolved {
    grid-column: 2;
    font: 500 10.5px/1.3 var(--font-mono);
    color: var(--fg-quiet);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-left: 2px;
  }

  /* On very narrow viewports (412px), collapse both group headings
     so the page doesn't blow out, and let the user expand each.
     The accordion is the density solution for open question B.
  */
  @media (max-width: 480px) {
    .mlm-section-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .mlm-section-label {
      padding-top: 0;
    }
    .mlm-section-resolved {
      grid-column: 1;
    }
  }

  /* ===== in-page tab strip ================================================ */
  .mlm-tab-strip {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0;
  }

  .mlm-tab {
    display: inline-flex;
    align-items: center;
    padding: 8px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: none;
    font: 600 13px/1 var(--font-body);
    color: var(--fg-muted);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
    border-radius: var(--r-2) var(--r-2) 0 0;
  }
  .mlm-tab:hover { color: var(--fg); }
  .mlm-tab.is-active {
    color: var(--fg);
    border-bottom-color: var(--mash-pulp);
  }

  /* ===== pipeline tab ===================================================== */
  .mlm-pipeline {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .mlm-sub-tabs {
    display: flex;
    gap: 4px;
  }

  .mlm-sub-tab {
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--surface-2);
    font: 600 11.5px/1 var(--font-body);
    color: var(--fg-muted);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }
  .mlm-sub-tab:hover { color: var(--fg); background: var(--surface-hover); }
  .mlm-sub-tab.is-active {
    background: var(--mash-pulp-soft);
    border-color: var(--mash-pulp-edge);
    color: var(--mash-pulp);
  }

  /* ===== two-pane layout (Option C) ======================================= */
  .mlm-pipeline-panes {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }
  @media (min-width: 640px) {
    .mlm-pipeline-panes {
      grid-template-columns: 1fr 280px;
      align-items: start;
    }
  }

  /* ===== flat track list editor (Option A) ================================ */
  .mlm-track-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    overflow: hidden;
    background: var(--surface);
  }

  .mlm-track-item {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--line);
  }
  .mlm-track-item:last-child { border-bottom: none; }
  .mlm-track-item.has-rail { border-left: 3px solid var(--mash-pulp); }

  .mlm-track-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    background: var(--surface);
    transition: background var(--dur-fast) var(--ease-out);
  }
  .mlm-track-row:hover { background: var(--surface-hover); }

  @media (max-width: 480px) {
    .mlm-track-row {
      grid-template-columns: auto 1fr;
      gap: 8px;
    }
    .mlm-track-model,
    .mlm-skip-toggle {
      grid-column: 1 / -1;
    }
  }

  .mlm-reorder-btns {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mlm-reorder-btn {
    width: 22px;
    height: 22px;
    font-size: 9px;
    padding: 0;
  }

  .mlm-track-name-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .mlm-track-label {
    font: 500 13px/1.3 var(--font-body);
    color: var(--fg);
  }

  .mlm-merge-badge {
    display: inline-flex;
    align-self: flex-start;
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--mash-pulp);
    background: var(--mash-pulp-soft);
    border: 1px solid var(--mash-pulp-edge);
    border-radius: var(--r-1);
    padding: 2px 5px;
    white-space: nowrap;
  }

  .mlm-track-model {
    font-size: 12px;
    padding: 7px 28px 7px 9px;
    min-width: 0;
  }

  .mlm-skip-toggle {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
    padding: 5px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    background: var(--surface-2);
    color: var(--fg-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--dur-fast) var(--ease-out);
  }
  .mlm-skip-toggle:hover { color: var(--fg); border-color: var(--fg-muted); }
  .mlm-skip-toggle.is-active {
    background: var(--amber-soft);
    border-color: #4d3f1c;
    color: var(--amber);
  }

  /* cover sub-row — dashed, indented */
  .mlm-cover-row {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 7px 14px 7px 22px;
    border-top: 1px dashed var(--line-strong);
    background: var(--ink-0);
  }
  @media (max-width: 480px) {
    .mlm-cover-row {
      grid-template-columns: auto 1fr auto;
    }
    .mlm-cover-label { display: none; }
  }

  .mlm-cover-glyph {
    font: 600 13px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .mlm-cover-label {
    font: 500 11px/1.3 var(--font-mono);
    color: var(--fg-muted);
    white-space: nowrap;
  }

  .mlm-cover-model {
    font-size: 12px;
    padding: 6px 26px 6px 8px;
    min-width: 0;
  }

  /* add-cover affordance row */
  .mlm-cover-add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 14px 5px 22px;
    border-top: 1px solid var(--line);
    background: var(--ink-0);
  }

  .mlm-cover-add {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
    padding: 4px 8px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-1);
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }
  .mlm-cover-add:hover { color: var(--fg); border-color: var(--fg-muted); }

  .mlm-cover-hint {
    margin: 0;
    font: 400 10.5px/1.3 var(--font-mono);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* skip divider row */
  .mlm-skip-div {
    padding: 5px 14px;
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.06em;
    color: var(--amber);
    background: var(--amber-soft);
    border-top: 1px solid #4d3f1c;
    text-align: center;
  }

  /* ===== run preview (right pane on desktop) ============================== */
  .mlm-run-preview {
    display: none; /* hidden on mobile — footer band takes over */
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 14px;
    background: var(--surface);
  }
  @media (min-width: 640px) {
    .mlm-run-preview { display: flex; }
  }

  .mlm-preview-head {
    font: 700 10px/1 var(--font-body);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
    margin-bottom: 4px;
  }

  .mlm-preview-ep {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--surface-2);
  }

  .mlm-preview-ep-label {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-quiet);
    margin-bottom: 4px;
  }

  .mlm-preview-skip {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.06em;
    color: var(--amber);
    text-align: center;
    padding: 3px 0;
  }

  .mlm-preview-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
  }
  .mlm-preview-group:last-of-type { border-bottom: none; }

  .mlm-preview-model {
    font: 700 10.5px/1 var(--font-mono);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mlm-preview-secs {
    font: 400 10px/1.3 var(--font-mono);
    color: var(--fg-muted);
  }

  .mlm-preview-cover-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font: 500 10.5px/1.3 var(--font-mono);
    color: var(--fg-muted);
    border-top: 1px dashed var(--line-strong);
    margin-top: 2px;
  }

  /* ===== EP cards (Option B preview) ===================================== */
  .mlm-ep-cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mlm-ep-card {
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 14px 16px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mlm-ep-card-label {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .mlm-ep-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mlm-ep-group-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  /* ===== pipeline footer (save + cost band) =============================== */
  .mlm-pipeline-footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 0 4px;
    border-top: 1px solid var(--line);
  }

  /* Sticky on mobile — appears above Save buttons */
  @media (max-width: 639px) {
    .mlm-pipeline-footer {
      position: sticky;
      bottom: 0;
      background: var(--surface);
      padding: 12px 0;
      z-index: 10;
      box-shadow: 0 -4px 16px color-mix(in srgb, var(--ink-9) 20%, transparent);
    }
  }

  .mlm-cost-band {
    font: 700 12px/1 var(--font-mono);
    letter-spacing: 0.02em;
    color: var(--fg-muted);
  }

  /* ===== Q3 per-section read-only link ==================================== */
  .mlm-link-btn {
    background: none;
    border: none;
    padding: 0;
    font: 600 13px/1.45 var(--font-body);
    color: var(--mash-pulp);
    cursor: pointer;
    text-decoration: underline;
  }
  .mlm-link-btn:hover { opacity: 0.8; }

  .mlm-section-select[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
