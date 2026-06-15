// music-league-bot — shared chrome (sidebar, brand mark, album art)

// hash a string to a stable small int
function mlHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

// Album-art placeholder. No real art — solid tinted blocks with the
// artist's mono initials, varied by a hash for visual rhythm. Per the
// design system: no gradients, no AI illustrations.
const ART_TINTS = [
  "#1c232c", "#283039", "#3a4451", "#1d3a2a", "#3a2e15",
  "#3b1a22", "#16263f", "#221a14", "#1a1f24",
];
const ART_PATTERNS = ["solid", "stripes", "rings", "tape"];

function AlbumArt({ artist, title, size = "sm", className = "" }) {
  const h = mlHash(artist + "·" + title);
  const tint = ART_TINTS[h % ART_TINTS.length];
  const pattern = ART_PATTERNS[(h >> 4) % ART_PATTERNS.length];
  const initials = artist
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div
      className={`ml-art ml-art--${size} ml-art-${pattern} ${className}`}
      style={{ background: tint }}
      aria-hidden="true"
    >
      <span className="ml-art-mono">{initials || "♪"}</span>
    </div>
  );
}

// Brand mark — "music-league-bot" wordmark in the sidebar. Uses the
// pulp extrusion only on the leading "ml" so the brand presence is
// quiet at sidebar size.
function BrandMark() {
  return (
    <div className="ml-brand">
      <span className="ml-brand-mark">m/l</span>
      <span className="ml-brand-slug">music-league-bot</span>
    </div>
  );
}

// Status dot used by leagues in the sidebar.
function statusClass(status) {
  if (status === "active") return "ml-league-dot--active";
  if (status === "voting") return "ml-league-dot--voting";
  if (status === "submissions-open") return "ml-league-dot--open";
  return "ml-league-dot--idle";
}
function statusLabel(status) {
  if (status === "active") return "submissions";
  if (status === "voting") return "voting";
  if (status === "submissions-open") return "open";
  return "idle";
}

function Sidebar({ activeNav = "round", activeLeagueId = "vinyl-scramblers" }) {
  const navs = [
    { id: "round",    glyph: "▸", label: "Active round",     tail: "r-14" },
    { id: "shortlist",glyph: "▢", label: "Shortlist",        tail: "11" },
    { id: "watcher",  glyph: "◉", label: "Chat watcher",     tail: "3 new" },
    { id: "convert",  glyph: "↔", label: "Link converter",   tail: "" },
    { id: "digest",   glyph: "✉", label: "Digest preview",   tail: "" },
    { id: "history",  glyph: "≡", label: "Round history",    tail: "13" },
    { id: "setup",    glyph: "⚙", label: "Setup",            tail: "" },
  ];
  return (
    <aside className="ml-side">
      <header className="ml-side-head">
        <p className="t-eyebrow" style={{ color: "var(--fg-quiet)" }}>Mash Co.</p>
        <BrandMark />
      </header>

      <ul className="ml-side-nav">
        {navs.map((n) => (
          <li
            key={n.id}
            className={"ml-nav " + (activeNav === n.id ? "is-on" : "")}
          >
            <span className="ml-nav-glyph">{n.glyph}</span>
            <span>{n.label}</span>
            {n.tail ? <span className="ml-nav-tail">{n.tail}</span> : null}
          </li>
        ))}
      </ul>

      <div className="ml-side-section">
        <p className="t-eyebrow">Leagues</p>
        {LEAGUES.map((l) => (
          <div
            key={l.id}
            className={"ml-league-row " + (activeLeagueId === l.id ? "is-active" : "")}
          >
            <span className={"ml-league-dot " + statusClass(l.status)} />
            <div>
              <div className="ml-league-name">{l.name}</div>
              <div className="ml-league-meta">r-{l.round} · {l.members} · {statusLabel(l.status)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ml-side-section">
        <p className="t-eyebrow">Cross-league next</p>
        <div className="ml-league-row" style={{cursor:"pointer"}}>
          <span className="ml-league-dot ml-league-dot--voting" />
          <div>
            <div className="ml-league-name" style={{ fontSize: 12 }}>The jukebox</div>
            <div className="ml-league-meta">voting closes Sun · 6 votes due</div>
          </div>
        </div>
        <div className="ml-league-row" style={{cursor:"pointer"}}>
          <span className="ml-league-dot ml-league-dot--open" />
          <div>
            <div className="ml-league-name" style={{ fontSize: 12 }}>Vibe shift club</div>
            <div className="ml-league-meta">theme posted · 4d open</div>
          </div>
        </div>
      </div>

      <footer className="ml-side-foot">
        <div className="ml-side-status">watcher live · 2d uptime</div>
        <div>sqlite ml-bot.db · 12.4 MB</div>
        <div>last poll 6:32:14 PM</div>
      </footer>
    </aside>
  );
}

// Star/pellet rating — 5 cells, the 5th is moss when active to signal
// "lock it in". Click handler optional.
function Rating({ value, size = "md", onChange }) {
  const cells = [1, 2, 3, 4, 5].map((i) => {
    const on = i <= value;
    const five = i === 5 && value === 5;
    return (
      <span
        key={i}
        className={"ml-rate-cell " + (on ? "is-on " : "") + (five ? "is-five" : "")}
        onClick={onChange ? () => onChange(i) : undefined}
      />
    );
  });
  return <span className={"ml-rate " + (size === "lg" ? "ml-rate--lg" : "")}>{cells}</span>;
}

// Source pill — spotify / youtube
function SourceTag({ source, label }) {
  return (
    <span className="ml-row-source">
      <span className={`ml-source-dot ml-source-dot--${source}`} />
      <span>{label || source}</span>
    </span>
  );
}

Object.assign(window, { AlbumArt, BrandMark, Sidebar, Rating, SourceTag, mlHash });
