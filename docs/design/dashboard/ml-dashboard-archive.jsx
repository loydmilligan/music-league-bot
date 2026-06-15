// the b-side — Digest Archive screen.
// Every past round digest, grouped by season, newest first. Each card opens
// the full digest artifact from the existing render pipeline.

function ArchiveScreen({ nav }) {
  // group by season (newest first)
  const seasons = {};
  DASH_ARCHIVE.forEach((a) => { (seasons[a.season] = seasons[a.season] || []).push(a); });
  const seasonKeys = Object.keys(seasons).sort((a, b) => b - a);

  return (
    <div className="bs-pad">
      <div className="bs-topbar">
        <button className="bs-back" onClick={nav.goHome}><BSIcon.chevL /> {DASH_LEAGUE.name}</button>
        <span className="bs-mini-mark">b/s</span>
      </div>

      <header className="bs-hero" style={{ gap: 8 }}>
        <div className="bs-hero-eyebrow">The archive</div>
        <h1 className="bs-hero-name" style={{ fontSize: 38 }}>Every round,<br />re-readable.</h1>
        <p className="bs-hero-tag">{DASH_ARCHIVE.length} digests and counting — the full story of each round, kept forever.</p>
      </header>

      {seasonKeys.map((sk) => (
        <section className="bs-sec" key={sk}>
          <div className="bs-arch-group-h">Season {sk} · {seasons[sk].length} rounds</div>
          <div className="bs-arch-list">
            {seasons[sk].map((a, i) => {
              const sub = memberById(a.submitter);
              return (
                <div className="bs-arch" key={a.n} style={{ "--hue": a.hue }} onClick={() => nav.openShare({
                  award: a.theme, blurb: `Won by ${sub.name} — “${a.winnerSong}” by ${a.winnerArtist}. ${a.votes} votes cast.`,
                  who: "Round " + a.n, initials: "R" + a.n, hue: a.hue, accent: "pulp",
                })}>
                  <div className="bs-arch-n">{a.n}</div>
                  <div className="bs-arch-body">
                    <div className="bs-arch-theme">{a.theme}</div>
                    <div className="bs-arch-win">
                      <Avatar member={sub} size="sm" />
                      <span><b>{a.winnerSong}</b> — {a.winnerArtist}</span>
                    </div>
                  </div>
                  <div className="bs-arch-meta">
                    {i === 0 && sk === seasonKeys[0] && <span className="bs-tag-new">New</span>}
                    <span className="bs-arch-date">{a.date}</span>
                    <span className="bs-arch-go"><BSIcon.chevR /></span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="bs-sec-sub" style={{ textAlign: "center", padding: "0 12px" }}>
        Each card opens the full digest — podium, the villain, vote flow and the chat recap — exactly as it was pressed.
      </div>

      <footer className="bs-footer">
        <div className="bs-footer-mark">the b/side</div>
        <div className="bs-footer-note"><b>{DASH_LEAGUE.name}</b> · {DASH_LEAGUE.seasons} seasons archived · shareable, no login</div>
      </footer>
    </div>
  );
}

Object.assign(window, { ArchiveScreen });
