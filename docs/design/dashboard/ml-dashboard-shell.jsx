// the b-side — shell: brand, phone/browser chrome, router, concept rail,
// and shared primitives (Avatar, icons, accent map). Consumes the DASH_*
// fixtures from ml-dashboard-data.jsx and the IOSDevice bezel from ios-frame.jsx.

// ── Icons (inherit currentColor) ──────────────────────────────────────────
const BSIcon = {
  lock: (p) => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" {...p}><rect x="4" y="10.5" width="16" height="10" rx="2.4" fill="currentColor"/><path d="M7.5 10.5V8a4.5 4.5 0 019 0v2.5" stroke="currentColor" strokeWidth="2.2"/></svg>),
  chevL: (p) => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" {...p}><path d="M15 4l-8 8 8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  chevR: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...p}><path d="M9 4l8 8-8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  star: (p) => (<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17.9 6.1 20.3l1.3-6.5L2.5 9.3l6.6-.8z"/></svg>),
  share: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 15V3m0 0L8 7m4-4l4 4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 12v6.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V12" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/></svg>),
  close: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...p}><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/></svg>),
  trophy: (p) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="currentColor" strokeWidth="1.8"/><path d="M7 6H4.5v1.5A3.5 3.5 0 007 11M17 6h2.5v1.5A3.5 3.5 0 0117 11M12 13v3m-3 4h6m-5 0l.6-2.5h4.8L16 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  heart: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 21s-7.5-4.7-10-9.4C.7 9 1.6 5.5 4.8 4.6 7 4 9 5 12 8c3-3 5-4 7.2-3.4 3.2.9 4.1 4.4 2.8 7C19.5 16.3 12 21 12 21z"/></svg>),
  bolt: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>),
  spark: (p) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z"/></svg>),
  thumbU: (p) => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" {...p}><path d="M7 10v10H4V10h3zm0 0l4-7c1.6 0 2.5 1 2.3 2.6L13 9h5.4c1.2 0 2 1.1 1.7 2.3l-1.6 6.4c-.2 1-1.1 1.7-2.2 1.7H7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>),
  thumbD: (p) => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" {...p}><path d="M17 14V4h3v10h-3zm0 0l-4 7c-1.6 0-2.5-1-2.3-2.6L11 15H5.6c-1.2 0-2-1.1-1.7-2.3l1.6-6.4C5.7 5.3 6.6 4.6 7.7 4.6H17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>),
};

const BS_ACCENTS = { pulp: "bs-acc-pulp", amber: "bs-acc-amber", sky: "bs-acc-sky", moss: "bs-acc-moss", ember: "bs-acc-ember" };
const bsAcc = (name) => BS_ACCENTS[name] || "bs-acc-pulp";

// ── Avatar monogram ───────────────────────────────────────────────────────
function Avatar({ member, hue, initials, size = "md" }) {
  const m = member || {};
  return (
    <div className="bs-av" data-size={size} style={{ background: hue || m.hue }}>
      {initials || m.initials}
    </div>
  );
}

// ── Share button ──────────────────────────────────────────────────────────
function ShareBtn({ label = "Share", onClick }) {
  return (
    <button className="bs-share-btn" onClick={onClick}>
      <BSIcon.share /> {label}
    </button>
  );
}

// ── Section header ────────────────────────────────────────────────────────
function SecHead({ eyebrow, title, sub, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {eyebrow && (
        <div className={"bs-eyebrow " + (accent ? bsAcc(accent) : "")}>
          {accent && <span className="bs-acc-dot" />}{eyebrow}
        </div>
      )}
      {title && <div className="bs-sec-title">{title}</div>}
      {sub && <div className="bs-sec-sub">{sub}</div>}
    </div>
  );
}

// ── Shareable card overlay ────────────────────────────────────────────────
function ShareOverlay({ payload, onClose }) {
  if (!payload) return null;
  const acc = bsAcc(payload.accent);
  return (
    <div className="bs-overlay" onClick={onClose}>
      <button className="bs-icon-btn bs-overlay-close" onClick={onClose}><BSIcon.close /></button>
      <div className={"bs-sharecard " + acc} onClick={(e) => e.stopPropagation()}>
        <div className="bs-sharecard-top">
          <span className="bs-sharecard-mark">the b/side</span>
          <span className="bs-sharecard-league">{DASH_LEAGUE.name} · S{DASH_LEAGUE.season}</span>
        </div>
        <div className="bs-sharecard-medal"><BSIcon.trophy /></div>
        <div>
          <div className="bs-sharecard-award">{payload.award}</div>
        </div>
        <div className="bs-sharecard-blurb">{payload.blurb}</div>
        <div className="bs-sharecard-foot">
          <Avatar hue={payload.hue} initials={payload.initials} size="sm" />
          <div className="bs-sharecard-name">{payload.who}<small>{DASH_LEAGUE.name}</small></div>
        </div>
      </div>
      <div className="bs-overlay-cap">Screenshot-ready · no login, no app link — just the award and the league name.</div>
    </div>
  );
}

// ── Concept rail (left of phone) ──────────────────────────────────────────
function ConceptRail({ screen, onJump }) {
  return (
    <aside className="bs-rail">
      <div className="bs-rail-mark">
        <span className="bs-rail-glyph">b/s</span>
        <div className="bs-rail-name">the b-side<small>sibling to m/l · consumer site</small></div>
      </div>

      <p className="bs-rail-lede">
        The <b>fan-facing flip side</b> of music-league-bot. One public micro-site per league —
        <b> Spotify Wrapped × high-school yearbook</b>, never an analytics dashboard. Warm, a little
        roast-y, built to be screenshotted and passed around the family chat.
      </p>

      <div className="bs-rail-block">
        <div className="bs-rail-h">Hosting model</div>
        <div className="bs-host">
          <div className="bs-host-url">
            <span style={{ color: "var(--moss)" }}><BSIcon.lock /></span>
            <span><span className="bs-url-host">digest.mattmariani.com/</span><span className="bs-url-slug">fam-jam-a9f3</span></span>
          </div>
          <div className="bs-host-note">
            No login. One <b>unguessable slug</b> per league, so members never see the operator app —
            and one league can't browse another.
          </div>
        </div>
      </div>

      <div className="bs-rail-block">
        <div className="bs-rail-h">Sitemap</div>
        <nav className="bs-map">
          {DASH_SITEMAP.map((n, i) => {
            const active =
              (screen === "home" && n.node === "League Home") ||
              (screen === "profile" && (n.node === "Player Profile" || n.node === "Players")) ||
              (screen === "archive" && n.node === "Digest Archive");
            const jump = n.node === "League Home" ? "home" : n.node === "Digest Archive" ? "archive" : (n.node === "Player Profile" || n.node === "Players") ? "profile" : null;
            return (
              <button key={i} className={"bs-map-node" + (active ? " is-active" : "")} data-depth={n.depth}
                onClick={() => jump && onJump(jump)}>
                <span className="bs-map-dot" />
                <span className="bs-map-txt">
                  <span className="bs-map-label">{n.node}{n.star ? " ★" : ""}</span>
                  <span className="bs-map-note">{n.note}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

// ── Phone (browser chrome wrapping the active screen) ─────────────────────
function PhoneFrame({ children, slug }) {
  return (
    <div className="bs-phone-shadow">
      <IOSDevice dark width={390} height={820}>
        <div className="bs-browser">
          <div className="bs-urlbar">
            <div className="bs-urlpill">
              <span style={{ color: "var(--moss)" }}><BSIcon.lock /></span>
              <span><span className="bs-url-host">digest.mattmariani.com/</span><span className="bs-url-slug">{slug}</span></span>
            </div>
          </div>
          <div className="bs-screen" id="bs-scroll">
            {children}
          </div>
        </div>
      </IOSDevice>
    </div>
  );
}

// ── App / router ──────────────────────────────────────────────────────────
function BSideApp() {
  const [screen, setScreen] = React.useState("home");
  const [playerId, setPlayerId] = React.useState("marisol");
  const [share, setShare] = React.useState(null);
  const scrollRef = React.useRef(null);

  // reset scroll on screen change
  React.useEffect(() => {
    const el = document.getElementById("bs-scroll");
    if (el) el.scrollTop = 0;
  }, [screen, playerId]);

  const nav = {
    goHome: () => setScreen("home"),
    goArchive: () => setScreen("archive"),
    goProfile: (id) => { if (id) setPlayerId(id); setScreen("profile"); },
    openShare: (payload) => setShare(payload),
  };

  let body = null;
  if (screen === "home") body = <HomeScreen nav={nav} />;
  else if (screen === "profile") body = <ProfileScreen nav={nav} member={memberById(playerId)} />;
  else if (screen === "archive") body = <ArchiveScreen nav={nav} />;

  return (
    <div className="bs-stage">
      <div className="bs-stage-inner">
        <ConceptRail screen={screen} onJump={(s) => setScreen(s)} />
        <div className="bs-phone-col">
          <div style={{ position: "relative" }}>
            <PhoneFrame slug="fam-jam-a9f3">{body}</PhoneFrame>
            <ShareOverlay payload={share} onClose={() => setShare(null)} />
          </div>
          <div className="bs-screenflip">
            {[["home", "Home"], ["profile", "Profile"], ["archive", "Archive"]].map(([s, l]) => (
              <button key={s} className={"bs-flip-btn" + (screen === s ? " is-active" : "")}
                onClick={() => setScreen(s)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  BSIcon, bsAcc, BS_ACCENTS, Avatar, ShareBtn, SecHead, ShareOverlay,
  ConceptRail, PhoneFrame, BSideApp,
});
