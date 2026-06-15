// the b-side — League Home screen.
// Hero · no-strife KPI ribbon · Season superlative reel · The family grid ·
// Season moments · Latest digest teaser · Footer.

function HomeScreen({ nav }) {
  const L = DASH_LEAGUE;

  const momentRows = [
    { key: "mostLoved",    icon: <BSIcon.heart />, accent: "moss",  kicker: "Most loved",    d: DASH_MOMENTS.mostLoved },
    { key: "mostDivisive", icon: <BSIcon.bolt />,  accent: "amber", kicker: "Most divisive", d: DASH_MOMENTS.mostDivisive },
    { key: "biggestUpset", icon: <BSIcon.spark />, accent: "sky",   kicker: "Biggest upset", d: DASH_MOMENTS.biggestUpset },
  ];

  return (
    <div className="bs-pad">

      {/* Masthead */}
      <div className="bs-topbar">
        <span className="bs-mini-mark" style={{ marginLeft: 0 }}>b/s <span style={{ fontStyle: "normal", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em", color: "var(--fg)" }}>the b-side</span></span>
        <button className="bs-icon-btn" style={{ marginLeft: "auto" }} onClick={() => nav.openShare({
          award: "Fam-Jam, Season 3", blurb: L.tagline, who: "Share the league", initials: "FJ", hue: HUE(25), accent: "pulp",
        })}><BSIcon.share /></button>
      </div>

      {/* League hero */}
      <header className="bs-hero">
        <div className="bs-hero-eyebrow">{L.name} · Season {L.season} · Round {L.round}</div>
        <h1 className="bs-hero-name">{L.name}</h1>
        <p className="bs-hero-tag">{L.tagline}</p>
        <span className="bs-fresh"><span className="bs-pulse" />Updated {L.updated}</span>
      </header>

      {/* KPI ribbon — celebratory, no win/loss ladder */}
      <section className="bs-sec">
        <SecHead eyebrow="By the numbers" title="The season so far" sub="Quirky over competitive — nobody's framed as a loser here." />
        <div className="bs-ribbon">
          {DASH_KPIS.map((k, i) => (
            <div className="bs-kpi" key={i}>
              <div className="bs-kpi-val">{k.value}</div>
              <div className="bs-kpi-label">{k.label}</div>
              <div className="bs-kpi-sub">{k.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Superlative reel */}
      <section className="bs-sec">
        <SecHead eyebrow="Yearbook awards" title={"Season " + L.season + " superlatives"} sub="Tap an award to open that player's profile." accent="amber" />
        <div className="bs-reel">
          {DASH_REEL.map((r, i) => {
            const w = memberById(r.winner);
            return (
              <div key={i} className={"bs-award " + bsAcc(r.accent)} role="button" tabIndex={0} onClick={() => nav.goProfile(r.winner)}>
                <div className="bs-medal"><BSIcon.trophy /></div>
                <div className="bs-award-name">{r.award}</div>
                <div className="bs-award-blurb">{r.blurb}</div>
                <div className="bs-award-winner">
                  <Avatar member={w} size="sm" />
                  <span className="bs-who">{w.name}<small>{w.role}</small></span>
                  <button className="bs-share-mini" style={{ marginLeft: "auto" }}
                    onClick={(e) => { e.stopPropagation(); nav.openShare({ award: r.award, blurb: r.blurb, who: w.name, initials: w.initials, hue: w.hue, accent: r.accent }); }}>
                    <BSIcon.share />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* The family */}
      <section className="bs-sec">
        <SecHead eyebrow={L.memberCount + " members"} title="The family" sub="Everyone gets a page. Tap a face." />
        <div className="bs-players">
          {DASH_MEMBERS.map((m) => (
            <button key={m.id} className="bs-player" onClick={() => nav.goProfile(m.id)}>
              <Avatar member={m} size="md" />
              <span className="bs-player-txt">
                <span className="bs-player-name">{m.name}</span>
                <span className="bs-player-role">{m.role}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Season moments */}
      <section className="bs-sec">
        <SecHead eyebrow="Consensus, not ranking" title="Moments of the season" />
        <div className="bs-moments">
          {momentRows.map((r) => {
            const sub = memberById(r.d.submitter);
            return (
              <div className="bs-moment" key={r.key}>
                <div className={"bs-moment-icon " + bsAcc(r.accent)} style={{ color: "var(--acc)" }}>{r.icon}</div>
                <div className="bs-moment-body">
                  <div className="bs-moment-kicker">{r.kicker} · R-{r.d.round}</div>
                  <div className="bs-moment-song">{r.d.title} <span>— {r.d.artist}</span></div>
                  <div className="bs-moment-line">{r.d.line} <span style={{ color: "var(--fg-quiet)" }}>({sub.name})</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Latest digest teaser */}
      <section className="bs-sec">
        <SecHead eyebrow="Fresh off the press" title="Latest round" sub="The full digest archive lives here too." />
        {(() => {
          const a = DASH_ARCHIVE[0];
          const sub = memberById(a.submitter);
          return (
            <div className="bs-featured" onClick={nav.goArchive} style={{ "--hue": a.hue }}>
              <div className="bs-featured-top">
                <span className="bs-roundbadge">ROUND {a.n}</span>
                <span className="bs-tag-new">Just closed</span>
              </div>
              <div className="bs-featured-theme">{a.theme}</div>
              <div className="bs-winner-row">
                <Avatar member={sub} size="sm" />
                <div className="bs-winner-meta">
                  <div className="bs-winner-song">{a.winnerSong} — {a.winnerArtist}</div>
                  <div className="bs-winner-by">Won by {sub.name} · {a.votes} votes cast</div>
                </div>
                <span className="bs-winner-medal" style={{ color: "var(--amber)" }}><BSIcon.trophy /></span>
              </div>
            </div>
          );
        })()}
        <button className="bs-share-btn" onClick={nav.goArchive} style={{ alignSelf: "stretch", justifyContent: "center" }}>
          Open the archive — {DASH_ARCHIVE.length} rounds <BSIcon.chevR />
        </button>
      </section>

      {/* Footer */}
      <footer className="bs-footer">
        <div className="bs-footer-mark">the b/side</div>
        <div className="bs-footer-note"><b>No login. Just this link.</b> Share it with the family — it never reveals the league HQ.</div>
      </footer>
    </div>
  );
}

Object.assign(window, { HomeScreen });
