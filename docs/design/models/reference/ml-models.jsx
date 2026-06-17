// music-league-bot — Models & AI screen
// The OpenRouter key + model manager, ported in spirit from
// music-league-strategist's ModelsManager. Paste an OpenRouter model id,
// look it up (mocked against a small catalog, falls back to a fabricated
// result for unknown ids), auto-fill its spec, save it. Each AI task the
// bot runs declares the properties a model must have; the picker only
// offers models that qualify.

const { useState } = React;

/* ---- capability vocabulary ------------------------------------------- */
const CAP_ORDER = ["reason", "stream", "vision", "tools", "json"];
const CAP_META = {
  reason: { g: "∴",  label: "Deep reasoning" },
  stream: { g: "⇉",  label: "Streaming" },
  vision: { g: "◉",  label: "Image input (vision)" },
  tools:  { g: "ƒ",  label: "Tool / function calling" },
  json:   { g: "{}", label: "Structured JSON output" },
};
const REQ_LABEL = { reason: "reasoning", stream: "streaming", vision: "vision", tools: "tools", json: "json" };

const PROVIDER_ABBR = {
  anthropic: "AN", openai: "AI", google: "GG", deepseek: "DS",
  "meta-llama": "ML", "x-ai": "XAI", mistralai: "MI", qwen: "QW",
};
function providerOf(id) { return id.split("/")[0]; }
function abbrOf(id) {
  const p = providerOf(id);
  return PROVIDER_ABBR[p] || p.slice(0, 2).toUpperCase();
}

// Cost tier from avg $/1M tokens: <$1 -> 1, <$10 -> 2, else 3.
function tierFromPricing(inPerM, outPerM) {
  const avg = (inPerM + outPerM) / 2;
  if (avg <= 0) return null;
  if (avg < 1) return 1;
  if (avg < 10) return 2;
  return 3;
}

/* ---- catalog the lookup resolves against ----------------------------- */
// pricing is $/1M tokens (in, out) for legibility. caps lists supported keys.
const CATALOG = {
  "anthropic/claude-sonnet-4":   { nick: "Claude Sonnet 4",  type: "general",   ctx: 200000, in: 3,    out: 15,   caps: ["reason", "stream", "vision", "tools", "json"], desc: "Balanced flagship. The default for anything tone-sensitive." },
  "anthropic/claude-opus-4":     { nick: "Claude Opus 4",    type: "reasoning", ctx: 200000, in: 15,   out: 75,   caps: ["reason", "stream", "vision", "tools", "json"], desc: "Deepest reasoning, highest cost. Reserve for hard calls." },
  "anthropic/claude-3.5-haiku":  { nick: "Claude Haiku 3.5", type: "general",   ctx: 200000, in: 0.8,  out: 4,    caps: ["stream", "tools", "json"], desc: "Fast and cheap. Good for high-volume parsing." },
  "openai/gpt-4o":               { nick: "GPT-4o",           type: "general",   ctx: 128000, in: 2.5,  out: 10,   caps: ["stream", "vision", "tools", "json"], desc: "OpenAI flagship multimodal." },
  "openai/o3-mini":              { nick: "o3-mini",          type: "reasoning", ctx: 200000, in: 1.1,  out: 4.4,  caps: ["reason", "stream", "tools", "json"], desc: "Cheap reasoning model. Strong at structured scoring." },
  "google/gemini-2.0-flash-001": { nick: "Gemini 2.0 Flash", type: "general",   ctx: 1000000, in: 0.1, out: 0.4,  caps: ["stream", "vision", "tools", "json"], desc: "Huge context, near-free, takes images." },
  "google/gemini-2.5-pro":       { nick: "Gemini 2.5 Pro",   type: "reasoning", ctx: 1000000, in: 1.25, out: 10,  caps: ["reason", "stream", "vision", "tools", "json"], desc: "Long-context reasoning with vision." },
  "deepseek/deepseek-chat":      { nick: "DeepSeek V3",      type: "general",   ctx: 64000,  in: 0.14, out: 0.28, caps: ["stream", "tools", "json"], desc: "Very capable, extremely affordable." },
  "deepseek/deepseek-r1":        { nick: "DeepSeek R1",      type: "reasoning", ctx: 64000,  in: 0.55, out: 2.19, caps: ["reason", "stream", "json"], desc: "Open reasoning model. Cheap thinking." },
  "meta-llama/llama-3.3-70b-instruct:free": { nick: "Llama 3.3 70B", type: "general", ctx: 128000, in: 0, out: 0, caps: ["stream", "json"], free: true, desc: "Free tier. Solid for non-critical drafting." },
  "x-ai/grok-2-1212":            { nick: "Grok 2",           type: "general",   ctx: 131072, in: 2,    out: 10,   caps: ["stream", "tools", "json"], desc: "xAI general model." },
};

function makeModel(id, info, extra) {
  const free = !!info.free;
  return {
    uid: id + "::" + Math.random().toString(36).slice(2, 7),
    id,
    nickname: info.nick,
    type: info.type,
    ctx: info.ctx,
    in: info.in, out: info.out,
    free,
    costTier: free ? null : tierFromPricing(info.in, info.out),
    caps: Object.fromEntries(CAP_ORDER.map((c) => [c, info.caps.includes(c)])),
    desc: info.desc || "",
    favorite: false,
    ...extra,
  };
}

// Resolve a pasted id -> spec. Known ids hit the catalog; unknown ids get a
// plausible fabricated spec so the flow never dead-ends.
function resolveLookup(id) {
  const clean = id.trim();
  if (CATALOG[clean]) return { id: clean, info: CATALOG[clean] };
  if (!clean.includes("/")) return null;
  const name = clean.split("/")[1].replace(/[-_:]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const reasoning = /o1|o3|r1|reason|think/i.test(clean);
  const isFree = /:free$/.test(clean);
  return {
    id: clean,
    fabricated: true,
    info: {
      nick: name, type: reasoning ? "reasoning" : "general",
      ctx: 128000, in: isFree ? 0 : 1, out: isFree ? 0 : 3,
      caps: reasoning ? ["reason", "stream", "json"] : ["stream", "tools", "json"],
      free: isFree, desc: "",
    },
  };
}

/* ---- the AI tasks the bot runs --------------------------------------- */
const AI_TASKS = [
  { id: "theme-fit", glyph: "TF", name: "Theme-fit scoring",
    desc: "Reads the round prompt plus a candidate track and scores how well it fits, 0–100, with a one-line rationale.",
    req: { json: true, reason: true, maxCost: 2 }, assigned: "openai/o3-mini" },
  { id: "chat-parse", glyph: "CP", name: "Chat parsing",
    desc: "Turns raw WhatsApp lines into structured mentions, theme proposals, and reactions. Runs on every inbound message, so it has to be cheap.",
    req: { json: true, tools: true, maxCost: 1 }, assigned: "google/gemini-2.0-flash-001" },
  { id: "digest", glyph: "DG", name: "Digest writing",
    desc: "Drafts the Friday recap the bot posts back into the league chat. Tone-sensitive prose — worth spending on.",
    req: { stream: true, maxCost: 2 }, assigned: "anthropic/claude-sonnet-4" },
  { id: "vibe", glyph: "VC", name: "Vibe clustering",
    desc: "Groups the working shortlist by sonic mood so you can catch a too-similar batch before voting opens.",
    req: { reason: true, json: true }, assigned: "anthropic/claude-sonnet-4" },
  { id: "art-read", glyph: "AR", name: "Cover-art read",
    desc: "Pulls mood and era cues from album art when track metadata is thin. Needs a model that takes images.",
    req: { vision: true, maxCost: 2 }, assigned: "google/gemini-2.0-flash-001" },
];

function effCost(m) { return m.free ? 0 : (m.costTier || 3); }
function qualifies(m, req) {
  for (const c of CAP_ORDER) if (req[c] && !m.caps[c]) return false;
  if (req.maxCost && effCost(m) > req.maxCost) return false;
  return true;
}

/* ---- small presentational bits --------------------------------------- */
function CapRow({ caps }) {
  return (
    <span className="mlm-caps">
      {CAP_ORDER.map((c) => (
        <span key={c} className={"mlm-cap " + (caps[c] ? "" : "is-off")} title={CAP_META[c].label}>
          {CAP_META[c].g}
        </span>
      ))}
    </span>
  );
}
function CostCell({ m }) {
  if (m.free) return <span className="mlm-cost-cell"><span className="mlm-free">FREE</span></span>;
  if (!m.costTier) return <span className="mlm-cost-cell"><span style={{ color: "var(--fg-quiet)" }}>—</span></span>;
  return (
    <span className="mlm-cost-cell">
      <span className={"mlm-cost mlm-cost--" + m.costTier} title={"$".repeat(m.costTier) + " cost tier"}>
        {"$".repeat(m.costTier)}
      </span>
    </span>
  );
}

/* ---- the screen ------------------------------------------------------- */
// demoQuery (optional): pre-resolve the lookup panel to its auto-filled state
// for static reference artboards. Leave undefined for the live screen.
function ModelsScreen({ demoQuery }) {
  const [models, setModels] = useState(() => [
    makeModel("anthropic/claude-sonnet-4", CATALOG["anthropic/claude-sonnet-4"], { favorite: true }),
    makeModel("openai/o3-mini", CATALOG["openai/o3-mini"]),
    makeModel("google/gemini-2.0-flash-001", CATALOG["google/gemini-2.0-flash-001"], { favorite: true }),
    makeModel("anthropic/claude-3.5-haiku", CATALOG["anthropic/claude-3.5-haiku"]),
    makeModel("deepseek/deepseek-chat", CATALOG["deepseek/deepseek-chat"]),
    makeModel("meta-llama/llama-3.3-70b-instruct:free", CATALOG["meta-llama/llama-3.3-70b-instruct:free"]),
  ]);
  const [assign, setAssign] = useState(() => Object.fromEntries(AI_TASKS.map((t) => [t.id, t.assigned])));

  const [showKey, setShowKey] = useState(false);
  const [keyVal, setKeyVal] = useState("sk-or-v1-8f3c2a9e7b1d4604a5e9c0f2");
  const [defaultModel, setDefaultModel] = useState("anthropic/claude-sonnet-4");

  // lookup panel
  const [query, setQuery] = useState(demoQuery || "");
  const [status, setStatus] = useState(demoQuery ? "done" : "idle"); // idle | loading | done | notfound
  const [draft, setDraft] = useState(() => {
    if (!demoQuery) return null;
    const r = resolveLookup(demoQuery);
    return r ? makeModel(r.id, r.info, { fabricated: !!r.fabricated }) : null;
  });

  const sorted = [...models].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  const hasKey = keyVal.trim().length > 0;

  function runLookup() {
    const q = query.trim();
    if (!q) return;
    setStatus("loading");
    setDraft(null);
    setTimeout(() => {
      const r = resolveLookup(q);
      if (!r) { setStatus("notfound"); return; }
      setStatus("done");
      setDraft(makeModel(r.id, r.info, { fabricated: !!r.fabricated }));
    }, 750);
  }
  function saveDraft() {
    if (!draft) return;
    setModels((ms) => [...ms.filter((m) => m.id !== draft.id), { ...draft }]);
    setQuery(""); setDraft(null); setStatus("idle");
  }
  function cancelDraft() { setQuery(""); setDraft(null); setStatus("idle"); }
  function toggleFav(uid) { setModels((ms) => ms.map((m) => m.uid === uid ? { ...m, favorite: !m.favorite } : m)); }
  function removeModel(uid) { setModels((ms) => ms.filter((m) => m.uid !== uid)); }

  return (
    <div className="ml-app">
      <Sidebar activeNav="models" />
      <main className="ml-main ml-main--narrow">
        <header className="ml-page-head">
          <p className="t-eyebrow">Models &amp; AI · OpenRouter</p>
          <h1>Models</h1>
          <p className="ml-page-sub">One OpenRouter key, a saved roster of models, and a rule for every job the bot does with an LLM. Paste an id straight off openrouter.ai, look it up, save it once — then pick it anywhere.</p>
        </header>

        {/* ---- API key + default ---- */}
        <article className="ml-card">
          <header className="ml-card-head">
            <div>
              <h3 className="ml-card-title">OpenRouter connection</h3>
              <p className="ml-card-sub">Every AI task routes through this one key. Stored locally, never in the chat ingest.</p>
            </div>
            <span className={"mlm-status " + (hasKey ? "mlm-status--ok" : "mlm-status--need")}>
              <span className="mlm-status-dot" />
              {hasKey ? "Configured" : "Required"}
            </span>
          </header>
          <div className="mlm-keybar">
            <div className="mlm-field">
              <label htmlFor="mlm-key">API key</label>
              <div className="mlm-key-field">
                <input
                  id="mlm-key" className="ml-input"
                  type={showKey ? "text" : "password"}
                  value={keyVal}
                  onChange={(e) => setKeyVal(e.target.value)}
                  placeholder="sk-or-v1-…"
                />
                <button className="mlm-reveal" onClick={() => setShowKey((s) => !s)} title={showKey ? "Hide" : "Reveal"}>
                  {showKey ? "hide" : "show"}
                </button>
              </div>
              <p className="mlm-field-hint">Get a key at openrouter.ai/keys ↗</p>
            </div>
            <div className="mlm-field">
              <label htmlFor="mlm-default">Default model</label>
              <select id="mlm-default" className="mlm-select" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                {sorted.map((m) => <option key={m.uid} value={m.id}>{m.nickname}</option>)}
              </select>
              <p className="mlm-field-hint">Used by any task without an explicit pick below.</p>
            </div>
          </div>
        </article>

        {/* ---- saved models ---- */}
        <article className="ml-card">
          <header className="ml-card-head">
            <div>
              <h3 className="ml-card-title">Saved models <span style={{ color: "var(--fg-quiet)", fontWeight: 500 }}>· {models.length}</span></h3>
              <p className="ml-card-sub">The roster. Star a model to float it to the top of every picker.</p>
            </div>
          </header>

          <div className="mlm-list">
            <div className="mlm-list-head">
              <span />
              <span />
              <span>Model</span>
              <span>Capabilities</span>
              <span>Cost</span>
              <span />
            </div>
            {sorted.map((m) => (
              <div className="mlm-row" key={m.uid}>
                <button className={"mlm-star " + (m.favorite ? "is-on" : "")} onClick={() => toggleFav(m.uid)} title={m.favorite ? "Unstar" : "Star"}>
                  {m.favorite ? "★" : "☆"}
                </button>
                <span className="mlm-prov" title={providerOf(m.id)}>{abbrOf(m.id)}</span>
                <div className="mlm-name-block">
                  <div className="mlm-name-row">
                    <span className="mlm-name">{m.nickname}</span>
                    <span className="mlm-type">{m.type}</span>
                  </div>
                  <div className="mlm-id-row">
                    <span className="mlm-id">{m.id}</span>
                    <span className="mlm-ctx">{(m.ctx / 1000).toFixed(0)}k ctx</span>
                  </div>
                </div>
                <CapRow caps={m.caps} />
                <CostCell m={m} />
                <div className="mlm-row-actions">
                  <button className="ml-icon-btn" title="Edit" onClick={() => { setQuery(m.id); setStatus("done"); setDraft({ ...m }); }}>✎</button>
                  <button className="ml-icon-btn" title="Remove" onClick={() => removeModel(m.uid)} style={{ color: "var(--ember)" }}>×</button>
                </div>
              </div>
            ))}
          </div>

          {/* lookup / add */}
          <div className={"mlm-add " + (draft ? "is-resolved" : "")}>
            <div className="mlm-field">
              <label htmlFor="mlm-lookup">Add a model — paste its OpenRouter id</label>
              <div className="mlm-lookup-row">
                <input
                  id="mlm-lookup" className="ml-input"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); if (status === "notfound") setStatus("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
                  placeholder="anthropic/claude-sonnet-4"
                />
                <button className="mash-btn mash-btn--secondary" onClick={runLookup} disabled={status === "loading" || !query.trim()}>
                  {status === "loading" ? <><span className="mlm-spin" /> Looking up</> : "Look up ↻"}
                </button>
              </div>
              {status === "notfound"
                ? <p className="mlm-lookup-err">No model with that id. Check it against openrouter.ai/models.</p>
                : <p className="mlm-field-hint">Pulls spec, context window, and pricing from the OpenRouter models API.</p>}
            </div>

            {draft && (
              <div className="mlm-autofill">
                <div className="mlm-resolved-bar">
                  <span className="mlm-status mlm-status--ok"><span className="mlm-status-dot" />Resolved</span>
                  <span className="mlm-resolved-tag"><b>{providerOf(draft.id)}</b> · {(draft.ctx / 1000).toFixed(0)}k context</span>
                  <span className="mlm-resolved-tag">{draft.free ? <b>free tier</b> : <>${draft.in}/M in · ${draft.out}/M out → <b>{"$".repeat(draft.costTier || 1)}</b></>}</span>
                  {draft.fabricated && <span className="mlm-resolved-tag" style={{ color: "var(--amber)" }}>· estimated (id not in catalog)</span>}
                </div>
                <div className="mlm-field">
                  <label>Nickname</label>
                  <input className="ml-input" style={{ fontFamily: "var(--font-body)", fontSize: 13 }} value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} />
                </div>
                <div className="mlm-field">
                  <label>Type</label>
                  <select className="mlm-select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                    <option value="general">general</option>
                    <option value="reasoning">reasoning</option>
                    <option value="coding">coding</option>
                    <option value="image">image</option>
                  </select>
                </div>
                <div className="mlm-field mlm-field-full">
                  <label>Capabilities (auto-detected — toggle to correct)</label>
                  <div className="mlm-caps" style={{ gap: 8 }}>
                    {CAP_ORDER.map((c) => (
                      <button
                        key={c}
                        className={"mlm-cap " + (draft.caps[c] ? "" : "is-off")}
                        style={{ width: "auto", padding: "0 9px", height: 26, gap: 6, display: "inline-flex", cursor: "pointer" }}
                        onClick={() => setDraft({ ...draft, caps: { ...draft.caps, [c]: !draft.caps[c] } })}
                        title={CAP_META[c].label}
                      >
                        <span>{CAP_META[c].g}</span>
                        <span style={{ fontSize: 10, letterSpacing: "0.04em" }}>{REQ_LABEL[c]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ml-btn-row mlm-field-full" style={{ marginTop: 2 }}>
                  <button className="mash-btn mash-btn--primary" onClick={saveDraft}>Save model</button>
                  <button className="mash-btn mash-btn--ghost" onClick={cancelDraft}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </article>

        {/* ---- task -> required props -> matching model ---- */}
        <article className="ml-card ml-card--accent">
          <header className="ml-card-head">
            <div>
              <h3 className="ml-card-title">Task assignments</h3>
              <p className="ml-card-sub">Each job the bot does declares the properties a model must have. The picker only offers models that qualify — change a model's spec above and the lists here re-filter.</p>
            </div>
          </header>

          <div className="mlm-tasks">
            {AI_TASKS.map((t) => {
              const eligible = sorted.filter((m) => qualifies(m, t.req));
              const current = assign[t.id];
              const currentOk = eligible.some((m) => m.id === current);
              return (
                <div className="mlm-task" key={t.id}>
                  <div className="mlm-task-info">
                    <div className="mlm-task-name">
                      <span className="mlm-task-glyph">{t.glyph}</span>
                      {t.name}
                    </div>
                    <p className="mlm-task-desc">{t.desc}</p>
                    <div className="mlm-reqs">
                      <span className="mlm-reqs-label">requires</span>
                      {CAP_ORDER.filter((c) => t.req[c]).map((c) => (
                        <span key={c} className="ml-chip ml-chip--sky">{CAP_META[c].g} {REQ_LABEL[c]}</span>
                      ))}
                      {t.req.maxCost && (
                        <span className="ml-chip ml-chip--amber">{"≤ " + "$".repeat(t.req.maxCost)}</span>
                      )}
                    </div>
                  </div>
                  <div className="mlm-task-pick">
                    <label>Assigned model</label>
                    <select
                      className="mlm-select"
                      value={currentOk ? current : ""}
                      onChange={(e) => setAssign((a) => ({ ...a, [t.id]: e.target.value }))}
                    >
                      {!currentOk && <option value="" disabled>Pick a qualifying model…</option>}
                      {eligible.map((m) => (
                        <option key={m.uid} value={m.id}>
                          {m.nickname}{m.free ? " · free" : " · " + "$".repeat(m.costTier || 1)}
                        </option>
                      ))}
                    </select>
                    <span className={"mlm-qual " + (eligible.length ? "" : "is-none")}>
                      <b>{eligible.length}</b> of {models.length} models qualify
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </main>
    </div>
  );
}

Object.assign(window, { ModelsScreen });
