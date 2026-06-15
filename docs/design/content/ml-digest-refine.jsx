// music-league-bot — /digest pipeline chrome + section refinement state
// Adds: pipeline strip, round selector, prepare drawer, per-section action
// chrome (include/exclude · regen · lock · reorder · edit · delete), and
// the regenerate modal. Sits on top of the variant-C digest from ml-digest.jsx.

const { useState: useDgS } = React;

// ============================================================ pipeline strip

function PipelineStrip({ stage = "refine" }) {
  // stages: prepare | draft | refine | finalize
  const steps = [
    { id: "prepare",  label: "Prepare data" },
    { id: "draft",    label: "Generate draft" },
    { id: "refine",   label: "Refine sections" },
    { id: "finalize", label: "Finalize & export" },
  ];
  const stageIdx = steps.findIndex(s => s.id === stage);
  return (
    <div className="dg-pipeline">
      {steps.map((s, i) => {
        const state = i < stageIdx ? "done" : i === stageIdx ? "active" : "pending";
        return (
          <React.Fragment key={s.id}>
            <button className={"dg-pipe-step is-" + state}>
              <span className="dg-pipe-num">{state === "done" ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </button>
            {i < steps.length - 1 ? <span className="dg-pipe-arrow">→</span> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ============================================================ round + league picker

function RoundPicker() {
  return (
    <div className="dg-round-picker" role="button">
      <span className="dg-round-pip" />
      <div className="dg-round-meta">
        <span className="dg-round-eyebrow">Round · league</span>
        <span className="dg-round-title">
          vinyl scramblers · <b>r-14</b> — must be love on the brain · closed may 17
        </span>
      </div>
      <span className="dg-round-caret">▾</span>
    </div>
  );
}

// ============================================================ prepare drawer (data check)

function PrepareDrawer() {
  const checks = [
    { name: "Round metadata",   ok: true,  src: "musicleague.com · scraped" },
    { name: "Submissions × 6",  ok: true,  src: "export.zip · r-14" },
    { name: "Votes × 30",       ok: true,  src: "export.zip · r-14" },
    { name: "Vote comments",    ok: true,  src: "export.zip · r-14" },
    { name: "Chat window mentions × 14", ok: true, src: "watcher · may 14–17" },
    { name: "Album art × 6",    ok: true,  src: "spotify api" },
  ];
  return (
    <div className="dg-prepare">
      <header className="dg-prepare-head">
        <h3>Prepare data · r-14</h3>
        <span className="summary">✓ all checks passed · ready to draft</span>
      </header>
      <div className="dg-prepare-checks">
        {checks.map(c => (
          <div key={c.name} className="dg-prepare-check">
            <span className={"glyph " + (c.ok ? "" : "is-miss")}>{c.ok ? "✓" : "!"}</span>
            <span>{c.name}</span>
            <span className="src">{c.src}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="mash-btn mash-btn--secondary mash-btn--sm">↻ Re-run music-league cli</button>
        <button className="mash-btn mash-btn--ghost mash-btn--sm" disabled style={{ opacity: 0.5 }}>↑ Upload export.zip manually</button>
        <span className="ml-chip" style={{ fontFamily: "var(--font-mono)" }}>v2</span>
        <span style={{ font: "500 11px/1 var(--font-mono)", color: "var(--fg-quiet)", marginLeft: "auto" }}>
          last checked may 17, 6:08 pm
        </span>
      </div>
    </div>
  );
}

// ============================================================ section action chrome

function SectionActions({ state, onToggle, onRegen, onLock, onKebab, kebabOpen, onKebabClose }) {
  return (
    <div className="dg-section-actions">
      <button
        className={"dg-sa-btn " + (state === "excluded" ? "" : "")}
        onClick={onToggle}
        title={state === "excluded" ? "Include in final" : "Exclude from final"}
        aria-pressed={state !== "excluded"}
      >
        {state === "excluded" ? "+" : "⊘"}
      </button>
      <button
        className="dg-sa-btn"
        onClick={onRegen}
        title="Regenerate this section…"
      >↻</button>
      <button
        className={"dg-sa-btn " + (state === "locked" ? "is-locked" : "")}
        onClick={onLock}
        title={state === "locked" ? "Unlock · allow whole-draft regen" : "Lock · pin this version"}
        aria-pressed={state === "locked"}
      >{state === "locked" ? "🔒" : "🔓"}</button>
      <span className="dg-sa-divider" />
      <div style={{ position: "relative" }}>
        <button
          className="dg-sa-btn"
          onClick={onKebab}
          title="More…"
          aria-haspopup="menu"
          aria-expanded={kebabOpen}
        >⋯</button>
        {kebabOpen ? <SectionKebabPop onClose={onKebabClose} /> : null}
      </div>
    </div>
  );
}

function SectionKebabPop({ onClose }) {
  return (
    <div className="dg-sa-kebab-pop" onClick={(e) => e.stopPropagation()}>
      <div className="dg-sa-kebab-row">
        <span className="glyph">✎</span>
        <span>Edit inline · no llm</span>
        <span className="hotkey">e</span>
      </div>
      <div className="dg-sa-kebab-row">
        <span className="glyph">↑</span>
        <span>Move section up</span>
        <span className="hotkey">[</span>
      </div>
      <div className="dg-sa-kebab-row">
        <span className="glyph">↓</span>
        <span>Move section down</span>
        <span className="hotkey">]</span>
      </div>
      <div className="dg-sa-kebab-divider" />
      <div className="dg-sa-kebab-row is-danger">
        <span className="glyph">✕</span>
        <span>Delete from draft</span>
        <span className="hotkey">⌫</span>
      </div>
    </div>
  );
}

// ============================================================ regenerate modal

const REGEN_CHIPS = [
  "be funnier",
  "be less mean",
  "more concise",
  "more dramatic",
  "facts only · less editorial",
];

function RegenModal({ sectionLabel, sectionPreview, onClose, activeChips = ["be less mean"], prompt = "Lean into the theme-chooser-as-villain angle. Stay dry. Keep Sam's comment intact." }) {
  return (
    <div className="dg-modal-scrim" onClick={onClose}>
      <div className="dg-modal" onClick={(e) => e.stopPropagation()}>
        <header className="dg-modal-head">
          <h3>Regenerate · <span style={{ color: "var(--mash-pulp)" }}>{sectionLabel}</span></h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="dg-modal-body">
          <span className="dg-modal-eyebrow">Current copy</span>
          <div className="dg-modal-current">{sectionPreview}</div>

          <span className="dg-modal-eyebrow">Quick steers · combinable</span>
          <div className="dg-modal-chips">
            {REGEN_CHIPS.map(c => (
              <button key={c} className={"dg-modal-chip " + (activeChips.includes(c) ? "is-on" : "")}>
                {c}
              </button>
            ))}
          </div>

          <span className="dg-modal-eyebrow">Specific instructions · optional</span>
          <textarea className="dg-modal-textarea" defaultValue={prompt}
            placeholder="Anything specific. Focus more on…, keep the Sam quote, drop the theme-chooser angle, lean into the rivalry, etc." />
          <p className="dg-modal-hint">
            The full source data (votes, comments, chat) is passed alongside your instructions. Cached prior versions of this section stay available.
          </p>
        </div>
        <footer className="dg-modal-foot">
          <span className="cost">~ 280 tokens · ~ 4¢ · cached after this run</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mash-btn mash-btn--ghost mash-btn--sm" onClick={onClose}>Cancel</button>
            <button className="mash-btn mash-btn--primary mash-btn--sm">↻ Regenerate</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ============================================================ section wrap helper

function SectionWrap({ state, label, regenModal, children }) {
  return (
    <div className={"dg-section-wrap" + (state === "excluded" ? " is-excluded" : "") + (state === "locked" ? " is-locked" : "") + (state === "regenerating" ? " is-regenerating" : "")}>
      {state === "excluded" ? (
        <div className="dg-excluded-banner">⊘ excluded from final · {label}</div>
      ) : null}
      {state === "locked" ? (
        <div className="dg-locked-banner">🔒 locked · whole-draft regen will skip</div>
      ) : null}
      {state === "regenerating" ? (
        <div className="dg-regen-banner">regenerating · {label} · ~ 4s</div>
      ) : null}
      <SectionActions state={state} />
      {children}
    </div>
  );
}

// ============================================================ refined page chrome wrapper

function DigestRefinePage({ withRegenModal = false, sectionStates = {}, showPrepare = false }) {
  return (
    <div className="dg-page">
      <div className="dg-chrome">
        <header className="dg-page-head">
          <p className="t-eyebrow">music-league-bot · /digest · {DIGEST_ROUND.id}</p>
          <h1>Round digest · refine sections</h1>
          <p className="dg-page-sub">
            Draft generated. Toggle, regenerate, lock, or reorder each section before exporting. Whole-draft regenerate skips locked sections. Excluded sections stay in the draft (recoverable) but don't appear in the export.
          </p>
        </header>

        <PipelineStrip stage="refine" />

        <div className="dg-topbar">
          <RoundPicker />
          <button className="mash-btn mash-btn--ghost">↻ Re-run draft</button>
        </div>

        {showPrepare ? <PrepareDrawer /> : null}

        <div className="dg-rel-field">
          <div className="dg-rel-field-head">
            <span className="dg-rel-field-lbl">Relationship context · primes the llm</span>
            <div className="dg-rel-field-meta">
              <span className="dg-rel-synced">synced · will update from r-14 on finalize</span>
            </div>
          </div>
          <textarea defaultValue={DIGEST_REL_CONTEXT} />
          <div className="dg-rel-field-foot">
            <span className="dg-rel-field-hint--inline">free-text · not included in the export · auto-updated after finalize</span>
            <span className="dg-rel-diff-link">view diff vs. before r-14 →</span>
          </div>
        </div>

        <div className="dg-page-actions">
          <button className="mash-btn mash-btn--primary">⤓ Finalize & download png</button>
          <button className="mash-btn mash-btn--secondary">↻ Regenerate whole draft</button>
          <button className="mash-btn mash-btn--ghost" disabled style={{ opacity: 0.5 }}>↗ Send to whatsapp</button>
          <span className="ml-chip" style={{ fontFamily: "var(--font-mono)" }}>v2</span>
          <span className="dg-page-actions-spacer" />
          <span style={{ font: "500 11px/1 var(--font-mono)", color: "var(--fg-quiet)" }}>
            draft cached · {Object.values(sectionStates).filter(s => s === "excluded").length} excluded · {Object.values(sectionStates).filter(s => s === "locked").length} locked
          </span>
        </div>

        {/* The digest — variant C with section action chrome wrapping each section */}
        <DigestCWithChrome sectionStates={sectionStates} />

        {withRegenModal ? (
          <RegenModal
            sectionLabel="back cover · chat notes"
            sectionPreview={`"Whoever submitted Lovefool owes us an explanation." — Then gave it 4 points anyway. The note still hasn't been delivered.`}
            activeChips={["be less mean"]}
            prompt="Lean into the theme-chooser-as-villain angle a touch more. Keep Sam's actual comment intact verbatim. Don't editorialize the trash talk."
            onClose={() => {}}
          />
        ) : null}
      </div>
    </div>
  );
}

// ============================================================ Variant C wrapped in section-action chrome

// Same content as DigestC, but every section is wrapped in <SectionWrap>
// so its action chrome (toggle / regen / lock / kebab) renders over the
// section header. Section states are driven by the sectionStates prop.

function DigestCWithChrome({ sectionStates = {} }) {
  const winner = DIGEST_SUBMISSIONS[0];

  const ST = (id) => sectionStates[id] || "default";

  return (
    <div className="dg-export dgC-bg">
      {/* MAST */}
      <header className="dgC-mast">
        <div className="dgC-mast-row1">
          <span>m/l</span><span className="sep">/</span>
          <span>vinyl scramblers</span><span className="sep">/</span>
          <span>S{DIGEST_ROUND.season}</span><span className="sep">/</span>
          <span>R-{DIGEST_ROUND.number}</span><span className="sep">/</span>
          <span className="pulp">closed {DIGEST_ROUND.voteClosed}</span>
        </div>
        <h1 className="dgC-mast-title">"{DIGEST_ROUND.name}"</h1>
        <p className="dgC-mast-deck">
          a round of <b>{DIGEST_ROUND.submissions}</b> songs by <b>{DIGEST_ROUND.voters}</b> voters · theme chosen by <b>{DIGEST_ROUND.themeChooser}</b> · <b>{DIGEST_ROUND.totalPointsAwarded}</b> points awarded
        </p>
      </header>

      {/* PODIUM */}
      <SectionWrap state={ST("podium")} label="A-side · final ranking">
        <section className="dg-section" style={{ paddingTop: 20 }}>
          <p className="dg-section-eyebrow">A-side · final ranking</p>
          <div className="dgC-tracks">
            {DIGEST_SUBMISSIONS.map(s => (
              <div key={s.title} className={"dgC-track " + (s.rank === 1 ? "dgC-track--gold" : s.rank === 2 ? "dgC-track--silver" : s.rank === 3 ? "dgC-track--bronze" : "")}>
                <span className="dgC-track-num">{String(s.rank).padStart(2, "0")}.</span>
                <div className="dgC-track-art"><ArtSlot artist={s.artist} title={s.title} size={44} /></div>
                <div className="dgC-track-meta">
                  <span className="dgC-track-title">{s.title}</span>
                  <span className="dgC-track-artist">{s.artist} · {s.year}</span>
                </div>
                <span className="dgC-track-sub">submitted by <span className="name">{s.submitter}</span></span>
                <span className="dgC-track-pts">{s.points} pt</span>
              </div>
            ))}
          </div>
        </section>
      </SectionWrap>

      {/* VILLAIN */}
      <SectionWrap state={ST("villain")} label="B-side · the downvote">
        <section className="dg-section">
          <p className="dg-section-eyebrow">B-side · the downvote</p>
          <div className="dgC-villain">
            <div className="dgC-villain-tag">[ REMOVED · -3 PTS · DOWNVOTED ]</div>
            <div className="dgC-villain-line">
              <span className="strike">{DIGEST_VILLAIN.songTitle}</span>
              <span>·</span>
              <span>{DIGEST_VILLAIN.songArtist}</span>
              <span>·</span>
              <span>submitted by</span>
              <span style={{ color: "var(--fg)", fontWeight: 700 }}>{DIGEST_VILLAIN.submitter}</span>
              <span>·</span>
              <span>from:</span>
              <span className="from">{DIGEST_VILLAIN.downvoter} (theme chooser)</span>
              <span>·</span>
              <span className="pts">{DIGEST_VILLAIN.points} pts</span>
            </div>
            <div className="dgC-villain-comment">
              "{DIGEST_VILLAIN.comment}"
            </div>
          </div>
        </section>
      </SectionWrap>

      {/* CREDITS (vote flow) */}
      <SectionWrap state={ST("flow")} label="Credits · notable votes">
        <section className="dg-section">
          <p className="dg-section-eyebrow">Credits · notable votes</p>
          <div className="dgC-credits">
            {DIGEST_FLOW_NOTABLE.map(n => (
              <React.Fragment key={n.text}>
                <div className={"dgC-credit-item dgC-credit-item--" + n.kind}>
                  <span className="dgC-credit-tag">
                    {n.kind === "first" && "first vote"}
                    {n.kind === "across" && "crossed lines"}
                    {n.kind === "mutual" && "mutual"}
                    {n.kind === "down" && "downvote"}
                  </span>
                  <span className="dgC-credit-line">
                    <span className="who">{n.from}</span> <span className="arrow">→</span> <span className="who">{n.to}</span>'s pick
                  </span>
                  <span className="dgC-credit-pts">{n.pts > 0 ? `+${n.pts}` : n.pts}</span>
                  <span className="dgC-credit-gloss">{n.text}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </section>
      </SectionWrap>

      {/* CONSENSUS */}
      <SectionWrap state={ST("consensus")} label="Consensus & controversy">
        <section className="dg-section">
          <p className="dg-section-eyebrow">Consensus & controversy</p>
          <div className="dgC-cc">
            <div className="dgC-cc-block dgC-cc-block--agree">
              <div className="dgC-cc-h">[ MOST AGREED-UPON ]</div>
              <div className="dgC-cc-title">"{DIGEST_CONSENSUS.agreed.title}"</div>
              <div className="dgC-cc-artist">{DIGEST_CONSENSUS.agreed.artist} · {DIGEST_CONSENSUS.agreed.submitter}</div>
              <div className="dgC-cc-spread">
                {DIGEST_CONSENSUS.agreed.spread.map((v, i) => (
                  <div key={i} className="row">
                    <span className="name">voter {i + 1}</span>
                    <span className="bar"><i style={{ width: (v / 5 * 100) + "%" }} /></span>
                    <span className="v">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dgC-cc-block dgC-cc-block--contest">
              <div className="dgC-cc-h">[ MOST CONTESTED ]</div>
              <div className="dgC-cc-title">"{DIGEST_CONSENSUS.contested.title}"</div>
              <div className="dgC-cc-artist">{DIGEST_CONSENSUS.contested.artist} · {DIGEST_CONSENSUS.contested.submitter}</div>
              <div className="dgC-cc-spread">
                {DIGEST_CONSENSUS.contested.spread.map((v, i) => (
                  <div key={i} className="row">
                    <span className="name">voter {i + 1}</span>
                    <span className="bar"><i style={{ width: (Math.abs(v) / 5 * 100) + "%" }} /></span>
                    <span className="v">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </SectionWrap>

      {/* QUOTES */}
      <SectionWrap state={ST("quotes")} label="Liner quotes">
        <section className="dg-section">
          <p className="dg-section-eyebrow">Liner quotes · llm picks</p>
          <div className="dgC-quotes">
            {DIGEST_COMMENTS.map(c => (
              <div key={c.who + c.whose_song} className="dgC-quote">
                <p className="dgC-quote-q">"{c.quote}"</p>
                <div className="dgC-quote-em">
                  {c.who} · {c.whose_song}
                  {c.points !== undefined ? ` · ${c.points} pt vote` : ""}
                  {c.rank ? ` · #${c.rank}` : ""}
                </div>
                <div className="dgC-quote-gloss">{c.gloss}</div>
              </div>
            ))}
          </div>
        </section>
      </SectionWrap>

      {/* CHAT */}
      <SectionWrap state={ST("chat")} label="Back cover · chat notes">
        <section className="dg-section">
          <p className="dg-section-eyebrow">Back cover · chat notes</p>
          <div className="dgC-chat">
            {DIGEST_CHAT.map(c => (
              <div key={c.headline} className="dgC-chat-row">
                <span className="dgC-chat-h">[ {c.headline.replace("·", "/")} ]</span>
                <div className="dgC-chat-body">
                  {c.quote ? <em>"{c.quote}"</em> : null}
                  {c.text || c.gloss}
                </div>
              </div>
            ))}
          </div>
        </section>
      </SectionWrap>

      <footer className="dgC-foot">
        <div>m/l · liner notes · <span className="pulp">"{DIGEST_ROUND.name}"</span></div>
        <div>vinyl scramblers · s3 · r-{DIGEST_ROUND.number} · pressed {DIGEST_ROUND.voteClosed}</div>
      </footer>
    </div>
  );
}

Object.assign(window, {
  DigestRefinePage, DigestCWithChrome,
  PipelineStrip, RoundPicker, PrepareDrawer,
  SectionActions, SectionKebabPop, SectionWrap, RegenModal,
});
