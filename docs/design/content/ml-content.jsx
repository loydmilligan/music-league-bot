// music-league-bot — Content screen (operator app)
// Renames the "Digest" surface to "Content" and adds two tabs:
//   Digest  — generate this round's digest (the existing pipeline)
//   Archive — publish / update each league's b-side site (same slug all season)
// Reuses PipelineStrip + RoundPicker from ml-digest-refine.jsx for the Digest
// tab, and the .dg-modal shell for the archive-update modal.

const { useState: useCtS } = React;

const CT_EMBLEM = {
  "vinyl-scramblers": "#c4502e",
  "vibe-shift-club":  "oklch(0.6 0.12 305)",
  "the-jukebox":      "oklch(0.62 0.1 215)",
  "deep-cuts-only":   "oklch(0.6 0.11 150)",
};
const ctInitials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// ── Sidebar (Content nav active, update badge) ──────────────────────────────
function ContentSidebar() {
  const navs = [
    { id: "round",    glyph: "▸", label: "Active round",   tail: "r-14" },
    { id: "shortlist",glyph: "▢", label: "Shortlist",      tail: "11" },
    { id: "watcher",  glyph: "◉", label: "Chat watcher",   tail: "3 new" },
    { id: "convert",  glyph: "↔", label: "Link converter", tail: "" },
    { id: "content",  glyph: "✉", label: "Content",        badge: CONTENT_UPDATES_READY },
    { id: "history",  glyph: "≡", label: "Round history",  tail: "13" },
    { id: "setup",    glyph: "⚙", label: "Setup",          tail: "" },
  ];
  const dot = (s) => s === "active" ? "ml-league-dot--active" : s === "voting" ? "ml-league-dot--voting" : s === "submissions-open" ? "ml-league-dot--open" : "ml-league-dot--idle";
  const lbl = (s) => s === "active" ? "submissions" : s === "voting" ? "voting" : s === "submissions-open" ? "open" : "idle";
  return (
    <aside className="ml-side">
      <header className="ml-side-head">
        <p className="t-eyebrow" style={{ color: "var(--fg-quiet)" }}>Mash Co.</p>
        <BrandMark />
      </header>
      <ul className="ml-side-nav">
        {navs.map((n) => (
          <li key={n.id} className={"ml-nav " + (n.id === "content" ? "is-on" : "")}>
            <span className="ml-nav-glyph">{n.glyph}</span>
            <span>{n.label}</span>
            {n.badge ? <span className="ml-nav-badge">{n.badge}</span> : n.tail ? <span className="ml-nav-tail">{n.tail}</span> : null}
          </li>
        ))}
      </ul>
      <div className="ml-side-section">
        <p className="t-eyebrow">Leagues</p>
        {CONTENT_LEAGUES.map((l) => (
          <div key={l.id} className={"ml-league-row " + (l.id === "vinyl-scramblers" ? "is-active" : "")}>
            <span className={"ml-league-dot " + dot(l.status)} />
            <div>
              <div className="ml-league-name">{l.name}</div>
              <div className="ml-league-meta">{l.bside ? `b-side · ${l.bside.archived} archived` : "no b-side yet"} · {lbl(l.status)}</div>
            </div>
          </div>
        ))}
      </div>
      <footer className="ml-side-foot">
        <div className="ml-side-status">watcher live · 2d uptime</div>
        <div>digest.mattmariani.com · {CONTENT_LEAGUES.filter(l=>l.bside).length} sites live</div>
        <div>last poll 6:32:14 PM</div>
      </footer>
    </aside>
  );
}

// ── Archive league row ──────────────────────────────────────────────────────
function LeagueRow({ league, onUpdate }) {
  const b = league.bside;
  const ready = b && b.pending;
  const cls = "ct-league" + (ready ? " is-ready" : "") + (!b ? " is-unpublished" : "");
  return (
    <div className={cls}>
      <div className="ct-league-emblem" style={{ background: CT_EMBLEM[league.id] || "var(--mash-pulp)" }}>{ctInitials(league.name)}</div>

      <div className="ct-league-body">
        <div className="ct-league-top">
          <span className="ct-league-name">{league.name}</span>
          {b ? <span className="ct-league-season">Season {b.season}</span> : <span className="ct-league-season" style={{ borderStyle: "dashed" }}>Not published</span>}
        </div>
        {b ? (
          <span className="ct-league-url"><span className="lock">🔒</span>{b.url}</span>
        ) : (
          <span className="ct-league-url" style={{ color: "var(--fg-quiet)" }}>Publishing mints a permanent, unguessable link for the season</span>
        )}
        <div className="ct-league-meta">
          {b ? (<>
            <span>{league.members} members</span><span className="dot" />
            <span>{b.archived} rounds archived</span><span className="dot" />
            <span>updated {b.lastPublished}</span>
          </>) : (
            <span>{league.members} members · {league.firstPublish.rounds} rounds ready for a first archive</span>
          )}
        </div>
      </div>

      <div className="ct-league-actions">
        {ready ? (
          <span className="ct-readypill ct-readypill--ready"><span className="pip" />1 update ready</span>
        ) : b ? (
          <span className="ct-readypill ct-readypill--current">✓ up to date</span>
        ) : (
          <span className="ct-readypill ct-readypill--idle">not published</span>
        )}

        {ready && <div className="ct-pending-line">R-{b.pending.round} <b>“{b.pending.theme}”</b> finalized {b.pending.closed}</div>}

        <div className="ct-league-btns">
          {b && <button className="mash-btn mash-btn--ghost mash-btn--sm">↗ View</button>}
          {ready ? (
            <button className="mash-btn mash-btn--primary mash-btn--sm" onClick={onUpdate}>Update archive →</button>
          ) : !b ? (
            <button className="mash-btn mash-btn--primary mash-btn--sm">Publish b-side →</button>
          ) : (
            <button className="mash-btn mash-btn--secondary mash-btn--sm" disabled style={{ opacity: 0.5 }}>No new digest</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Archive tab ─────────────────────────────────────────────────────────────
function ArchiveTab({ onUpdate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ct-archive-intro">
        <p className="lede">
          Each league has <b>one b-side site</b> on digest.mattmariani.com — one unguessable link, reused all season.
          When a round's digest finalizes it's <b>ready to add to the archive</b>. Publishing an update refreshes the same link;
          members never need a new one.
        </p>
      </div>
      <div className="ct-leagues">
        {CONTENT_LEAGUES.map((l) => (
          <LeagueRow key={l.id} league={l} onUpdate={l.id === "vinyl-scramblers" ? onUpdate : undefined} />
        ))}
      </div>
    </div>
  );
}

// ── Digest tab (the existing pipeline, compactly) ───────────────────────────
function DigestTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dg-topbar">
        <RoundPicker />
        <button className="mash-btn mash-btn--ghost">↻ Re-run draft</button>
      </div>
      <PipelineStrip stage="refine" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="mash-btn mash-btn--primary">Open refine sprint →</button>
        <button className="mash-btn mash-btn--secondary">⤓ Finalize &amp; export png</button>
        <span style={{ font: "500 11px/1.4 var(--font-mono)", color: "var(--fg-quiet)", marginLeft: "auto" }}>
          this round's shareable digest · posts to the chat + feeds the archive
        </span>
      </div>
      <p style={{ font: "500 12px/1.55 var(--font-mono)", color: "var(--fg-muted)", margin: 0, maxWidth: "70ch" }}>
        The Digest tab is the existing generate → refine → finalize pipeline, unchanged. Finalizing a digest is what makes
        a round <b style={{ color: "var(--fg-2)" }}>available to add</b> to that league's archive over on the Archive tab.
      </p>
    </div>
  );
}

// ── Archive update modal ────────────────────────────────────────────────────
function UpdateModal({ onClose, onGenerate }) {
  const U = ARCHIVE_UPDATE;
  const [decisions, setDecisions] = useCtS(() => Object.fromEntries(U.sections.filter(s => s.kind === "recompute").map(s => [s.id, s.decision])));
  const [share, setShare] = useCtS("card");
  const set = (id, v) => setDecisions((d) => ({ ...d, [id]: v }));
  const refreshing = Object.values(decisions).filter(v => v === "refresh").length;

  return (
    <div className="dg-modal-scrim" onClick={onClose}>
      <div className="dg-modal ct-modal" onClick={(e) => e.stopPropagation()}>
        <header className="dg-modal-head">
          <h3>Update b-side · <span style={{ color: "var(--mash-pulp)" }}>{U.league}</span></h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="dg-modal-body">
          <p className="ct-modal-sub">
            Adding <b>R-{U.round} — “{U.theme}”</b> to the archive. Pick what recomputes from the new round.
            Held sections keep their current version; locked sections never auto-update.
          </p>

          <div className="ct-uplist">
            {U.sections.map((s) => {
              const dec = decisions[s.id];
              const rowCls = "ct-up-row" + (s.kind === "add" ? " is-add" : dec === "hold" ? " is-held" : dec === "lock" ? " is-locked" : "");
              return (
                <div key={s.id} className={rowCls}>
                  <span className="ct-up-glyph">{s.kind === "add" ? "+" : "↻"}</span>
                  <div className="ct-up-body">
                    <div className="ct-up-label">
                      {s.label}
                      {s.required && <span className="ct-up-required">added</span>}
                    </div>
                    <div className="ct-up-note">{s.note}</div>
                    <div className="ct-up-detail">{s.detail}</div>
                    {s.steerable && dec === "refresh" && (
                      <button className="ct-up-steer">↻ steer this rewrite…</button>
                    )}
                  </div>
                  {s.kind === "add" ? (
                    <span className="ct-add-fixed">timeline</span>
                  ) : (
                    <div className="ct-seg">
                      {["refresh", "hold", "lock"].map((v) => (
                        <button key={v} data-v={v} className={dec === v ? "is-on" : ""} onClick={() => set(s.id, v)}>
                          {v === "lock" ? "🔒 lock" : v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ct-config">
            <span className="ct-config-lbl">Announce</span>
            <div className="ct-seg">
              {[["card", "share card"], ["link", "link only"], ["none", "silent"]].map(([v, l]) => (
                <button key={v} data-v={v === "card" ? "refresh" : ""} className={share === v ? "is-on" : ""} onClick={() => setShare(v)}>{l}</button>
              ))}
            </div>
            <span className="ct-sluglock" style={{ marginLeft: "auto" }}><span className="lock">🔒</span>same slug · <b>{U.slug}</b></span>
            <span className="ct-config-hint">Members keep the exact link they already have — the archive just gains a round and the live numbers refresh.</span>
          </div>
        </div>
        <footer className="dg-modal-foot">
          <span className="cost">{refreshing} section{refreshing === 1 ? "" : "s"} refresh · ~ 1.2k tokens · ~ 14¢ · same slug</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mash-btn mash-btn--ghost mash-btn--sm" onClick={onClose}>Cancel</button>
            <button className="mash-btn mash-btn--primary mash-btn--sm" onClick={onGenerate}>Generate update →</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Published / reshare state (after Generate) ──────────────────────────────
function PublishedState() {
  const S = ARCHIVE_SHARE;
  return (
    <div className="ct-published">
      <div className="ct-published-head">
        <div className="ct-published-check">✓</div>
        <div>
          <div className="ct-published-title">b-side updated · Round {S.round} is live in the archive</div>
          <div className="ct-published-sub">{S.league} · published to {S.url} · same link as always</div>
        </div>
      </div>

      <div className="ct-reshare">
        <div className="ct-reshare-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="ct-reshare-mark">the b/side</span>
            <span className="ct-reshare-kicker">{S.headline}</span>
          </div>
          <div className="ct-reshare-headline">Round {S.round} — “{S.theme}”</div>
          <div className="ct-reshare-blurb">{S.blurb}</div>
          <div className="ct-reshare-url"><span className="lock">🔒</span>{S.url}</div>
        </div>
        <div className="ct-reshare-actions">
          <button className="mash-btn mash-btn--primary">↗ Send to WhatsApp</button>
          <button className="mash-btn mash-btn--secondary">⧉ Copy share card</button>
          <span className="ct-or">or</span>
          <button className="mash-btn mash-btn--ghost">⧉ Copy link only</button>
        </div>
      </div>
    </div>
  );
}

// ── Whole Content screen (shell + tabs + body) ──────────────────────────────
function ContentScreen({ tab = "archive", modal = false, published = false }) {
  const [t, setT] = useCtS(tab);
  const [showModal, setShowModal] = useCtS(modal);
  const [isPublished, setIsPublished] = useCtS(published);

  return (
    <div className="ml-app">
      <ContentSidebar />
      <main className="ml-main">
        <header className="ml-page-head">
          <p className="t-eyebrow">Content · vinyl scramblers + 3 leagues</p>
          <h1>Content</h1>
          <p className="ml-page-sub">Generate this round's digest, and keep each league's shareable b-side archive up to date — one link per league, all season.</p>
        </header>

        <div className="ct-tabrow">
          <div className="ct-tabs">
            <button className={"ct-tab " + (t === "digest" ? "is-on" : "")} onClick={() => setT("digest")}>
              <span className="ct-tab-glyph">✉</span> Digest
            </button>
            <button className={"ct-tab " + (t === "archive" ? "is-on" : "")} onClick={() => setT("archive")}>
              <span className="ct-tab-glyph">≣</span> Archive
              {CONTENT_UPDATES_READY > 0 && <span className="ct-count">{CONTENT_UPDATES_READY}</span>}
            </button>
          </div>
          <span className="ct-tabrow-note">{t === "archive" ? `${CONTENT_UPDATES_READY} leagues have a new digest ready to archive` : "round r-14 · draft cached"}</span>
        </div>

        {t === "digest"
          ? <DigestTab />
          : isPublished
            ? <PublishedState />
            : <ArchiveTab onUpdate={() => setShowModal(true)} />}

        {showModal && <UpdateModal onClose={() => setShowModal(false)} onGenerate={() => { setShowModal(false); setIsPublished(true); }} />}
      </main>
    </div>
  );
}

Object.assign(window, {
  ContentScreen, ContentSidebar, ArchiveTab, DigestTab,
  LeagueRow, UpdateModal, PublishedState,
});
