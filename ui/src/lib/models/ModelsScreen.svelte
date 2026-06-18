<script lang="ts">
  import './models.css';
  import { onMount } from 'svelte';
  import {
    CAP_ORDER, CAP_META, effCost, qualifies, tierFromPricing,
    abbrOf, providerOf,
    type Model, type BucketState, type BucketReq,
  } from './qualify.js';

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

  <!-- ===== Per-section overrides card ===== -->
  {#if sectionsLoaded && models.length >= 1}
    <article class="ml-card mlm-sections-card">
      <header class="ml-card-head">
        <div>
          <h3 class="ml-card-title">Per-section overrides</h3>
          <p class="ml-card-sub">
            Pin a specific model to each AI task. A pinned section ignores the bucket default.
            "(use default)" clears the pin and falls back to the Predict or Digest bucket.
          </p>
        </div>
        {#if sectionsMocked}
          <span class="mlm-status mlm-status--need">
            <span class="mlm-status-dot"></span>API pending
          </span>
        {/if}
      </header>

      {#if sectionsMocked}
        <p style="margin:0;font:500 11.5px/1.45 var(--font-mono);color:var(--amber);">
          &#9888; Sections API not yet available — panel rendered from local mock.
          Selects are non-functional until Lane A ships the endpoint.
        </p>
      {/if}

      <!-- Digest sections bucket -->
      <div class="mlm-section-group">
        <button
          class="mlm-section-group-head"
          onclick={() => (digestOpen = !digestOpen)}
          aria-expanded={digestOpen}
        >
          <span class="mlm-section-group-label">Digest sections</span>
          <span class="mlm-section-group-badge" style="display:flex;align-items:center;gap:8px;">
            {#if digestOverrideCount > 0}
              <span class="ml-chip ml-chip--pulp">{digestOverrideCount} overridden</span>
            {/if}
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
                  onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    setSectionModel(s.section, v === '__default__' ? null : v);
                  }}
                  disabled={sectionsMocked}
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
            {#if predictOverrideCount > 0}
              <span class="ml-chip ml-chip--pulp">{predictOverrideCount} overridden</span>
            {/if}
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
                  onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    setSectionModel(s.section, v === '__default__' ? null : v);
                  }}
                  disabled={sectionsMocked}
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
</style>
