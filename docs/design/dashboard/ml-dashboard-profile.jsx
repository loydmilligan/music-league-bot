// the b-side — Player Profile screen (the heart).
// Hero · Signature superlative (trophy) · Taste Fingerprint (chips · spectrum ·
// rewards/punishes) · Yearbook superlatives · Biggest Fan/Hater · Your People
// (Overlap v2, two honest metrics) · Discovery playlist. Degrades for lite members.

function FingerprintChips({ member }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {member.signatureArtists && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div className="bs-rp-h" style={{ color: "var(--fg-quiet)" }}>Signature artists</div>
          <div className="bs-chips">
            {member.signatureArtists.map((a, i) => (
              <span key={i} className={"bs-chip" + (a.star ? " bs-chip--star" : "")}>
                {a.star && <BSIcon.star />}{a.name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        {member.genres && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="bs-rp-h" style={{ color: "var(--fg-quiet)" }}>Genres</div>
            <div className="bs-chips">{member.genres.map((g, i) => <span key={i} className="bs-chip">{g}</span>)}</div>
          </div>
        )}
        {member.eras && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="bs-rp-h" style={{ color: "var(--fg-quiet)" }}>Eras</div>
            <div className="bs-chips">{member.eras.map((e, i) => <span key={i} className="bs-chip bs-chip--soft">{e}</span>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileScreen({ nav, member: m }) {
  const full = m.tier === "full";

  return (
    <div className="bs-pad">
      {/* top bar */}
      <div className="bs-topbar">
        <button className="bs-back" onClick={nav.goHome}><BSIcon.chevL /> {DASH_LEAGUE.name}</button>
        <span className="bs-mini-mark">b/s</span>
      </div>

      {/* hero */}
      <header className="bs-phero">
        <div className="bs-phero-top">
          <Avatar member={m} size="lg" />
          <div className="bs-phero-id">
            <div className="bs-phero-name">{m.name}</div>
            <div className="bs-phero-role">{m.role}</div>
            <div className="bs-phero-joined">{m.joined}</div>
          </div>
        </div>
        <p className="bs-phero-headline">{m.headline}</p>
        {m.stat && (
          <div className="bs-statline">
            <div className="bs-stat"><div className="bs-stat-val">{m.stat.submitted}</div><div className="bs-stat-label">submitted</div></div>
            <div className="bs-stat"><div className="bs-stat-val">{m.stat.avgPts}</div><div className="bs-stat-label">avg pts</div></div>
            <div className="bs-stat"><div className="bs-stat-val">{m.stat.wins}</div><div className="bs-stat-label">round wins</div></div>
          </div>
        )}
      </header>

      {/* signature superlative — the trophy */}
      {m.signatureSuperlative && (
        <section className="bs-sec">
          <div className={"bs-trophy " + bsAcc("amber")}>
            <div className="bs-trophy-medal"><BSIcon.trophy /></div>
            <div className="bs-trophy-body">
              <div className="bs-trophy-eyebrow">{m.name}'s headline award</div>
              <div className="bs-trophy-name">{m.signatureSuperlative.award}</div>
              <div className="bs-trophy-blurb">{m.signatureSuperlative.blurb}</div>
            </div>
          </div>
          <ShareBtn label="Share this award" onClick={() => nav.openShare({
            award: m.signatureSuperlative.award, blurb: m.signatureSuperlative.blurb,
            who: m.name, initials: m.initials, hue: m.hue, accent: "amber",
          })} />
        </section>
      )}

      {/* taste fingerprint */}
      <section className="bs-sec">
        <SecHead eyebrow="Taste fingerprint" title="What makes them tick" sub="An AI read of three seasons of picks and votes." accent="pulp" />
        <FingerprintChips member={m} />

        {m.spectrum && (
          <div className="bs-spectrum">
            {m.spectrum.map((s, i) => (
              <div className="bs-spec-row" key={i}>
                <div className="bs-spec-ends"><span className="bs-end-l">{s.left}</span><span className="bs-end-r">{s.right}</span></div>
                <div className="bs-spec-track"><span className="bs-spec-dot" style={{ left: s.value + "%" }} /></div>
              </div>
            ))}
          </div>
        )}

        {(m.rewards || m.punishes) && (
          <div className="bs-rp">
            <div className="bs-rp-col" data-kind="up">
              <div className="bs-rp-h"><BSIcon.thumbU /> Rewards</div>
              {m.rewards.map((r, i) => <div className="bs-rp-item" key={i}>{r}</div>)}
            </div>
            <div className="bs-rp-col" data-kind="down">
              <div className="bs-rp-h"><BSIcon.thumbD /> Punishes</div>
              {m.punishes.map((r, i) => <div className="bs-rp-item" key={i}>{r}</div>)}
            </div>
          </div>
        )}
      </section>

      {/* yearbook superlatives */}
      {m.superlatives && m.superlatives.length > 0 && (
        <section className="bs-sec">
          <SecHead eyebrow="More awards" title="Yearbook superlatives" accent="sky" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {m.superlatives.map((s, i) => (
              <div key={i} className={"bs-trophy " + bsAcc(s.accent)} style={{ borderRadius: "var(--r-4)", padding: "14px" }}>
                <div className="bs-trophy-medal" style={{ width: 38, height: 38, borderRadius: 11 }}><BSIcon.star /></div>
                <div className="bs-trophy-body">
                  <div className="bs-trophy-name" style={{ fontSize: 16 }}>{s.award}</div>
                  <div className="bs-trophy-blurb" style={{ fontSize: 12.5 }}>{s.blurb}</div>
                </div>
                <button className="bs-share-mini" onClick={() => nav.openShare({ award: s.award, blurb: s.blurb, who: m.name, initials: m.initials, hue: m.hue, accent: s.accent })}>
                  <BSIcon.share />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* biggest fan / hater */}
      {(m.biggestFan || m.biggestHater) && (
        <section className="bs-sec">
          <SecHead eyebrow="Vote relationships" title="Biggest fan & friendly hater" sub="Who rewards your picks — and who buries them, lovingly." accent="moss" />
          <div className="bs-fh">
            {m.biggestFan && (
              <div className="bs-fhcard" data-kind="fan">
                <div className="bs-fh-tag"><BSIcon.heart /> Biggest fan</div>
                <div className="bs-fh-who">
                  <Avatar member={memberById(m.biggestFan.who.toLowerCase())} hue={(memberById(m.biggestFan.who.toLowerCase())||{}).hue || HUE(150)} initials={m.biggestFan.who.slice(0,2).toUpperCase()} size="sm" />
                  <span className="bs-fh-whoname">{m.biggestFan.who}</span>
                  <span className="bs-fh-pts">+{m.biggestFan.pts}</span>
                </div>
                <div className="bs-fh-line">{m.biggestFan.line}</div>
              </div>
            )}
            {m.biggestHater && (
              <div className="bs-fhcard" data-kind="hater">
                <div className="bs-fh-tag"><BSIcon.bolt /> Friendly hater</div>
                <div className="bs-fh-who">
                  <Avatar member={memberById(m.biggestHater.who.toLowerCase())} hue={(memberById(m.biggestHater.who.toLowerCase())||{}).hue || HUE(45)} initials={m.biggestHater.who.slice(0,2).toUpperCase()} size="sm" />
                  <span className="bs-fh-whoname">{m.biggestHater.who}</span>
                  <span className="bs-fh-pts">{m.biggestHater.pts}</span>
                </div>
                <div className="bs-fh-line">{m.biggestHater.line}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* your people — overlap v2 (two honest metrics) */}
      {(m.voteTwins || m.voteTogether) && (
        <section className="bs-sec">
          <SecHead eyebrow="Overlap v2.0" title="Your people" sub="Two honest reads — who you vote with, and who just shares your taste." accent="pulp" />
          <div className="bs-people-split">
            {m.voteTogether && (
              <div className="bs-people-group bs-person-grp1">
                <div className="bs-people-gh">
                  <div className="bs-people-gt">Vote together <span className="bs-tag2">within shared rounds</span></div>
                  <div className="bs-people-gnote">How often you actually hand each other points when you're in the same round.</div>
                </div>
                {m.voteTogether.map((p, i) => (
                  <div className="bs-person" key={i}>
                    <Avatar member={memberById(p.who.toLowerCase())} hue={(memberById(p.who.toLowerCase())||{}).hue || HUE(200)} initials={p.who.slice(0,2).toUpperCase()} size="sm" />
                    <span className="bs-person-name">{p.who}</span>
                    <span className="bs-person-bar"><span className="bs-person-fill" style={{ width: p.pct + "%" }} /></span>
                    <span className="bs-person-pct">{p.pct}%</span>
                  </div>
                ))}
              </div>
            )}
            {m.voteTwins && (
              <div className="bs-people-group bs-person-grp2">
                <div className="bs-people-gh">
                  <div className="bs-people-gt">Taste twins <span className="bs-tag2">across all leagues</span></div>
                  <div className="bs-people-gnote">Similar taste even when you've never shared a round — no penalty for no overlap.</div>
                </div>
                {m.voteTwins.map((p, i) => (
                  <div className="bs-person" key={i}>
                    <Avatar member={memberById(p.who.toLowerCase())} hue={(memberById(p.who.toLowerCase())||{}).hue || HUE(280)} initials={p.who.slice(0,2).toUpperCase()} size="sm" />
                    <span className="bs-person-name">{p.who}</span>
                    <span className="bs-person-bar"><span className="bs-person-fill" style={{ width: p.pct + "%" }} /></span>
                    <span className="bs-person-pct">{p.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* discovery playlist */}
      {m.playlist && (
        <section className="bs-sec">
          <SecHead eyebrow="Recommendations" title="A playlist with an agenda" accent="ember" />
          <div className="bs-playlist">
            <div className="bs-pl-head">
              <div className="bs-pl-kicker"><BSIcon.spark /> For {m.name}</div>
              <div className="bs-pl-name">{m.playlist.name}</div>
              <div className="bs-pl-nudge">{m.playlist.nudge}</div>
            </div>
            {m.playlist.tracks.map((t, i) => (
              <div className="bs-pl-track" key={i}>
                <span className="bs-pl-num">{String(i + 1).padStart(2, "0")}</span>
                <div className="bs-pl-track-body">
                  <div className="bs-pl-title">{t.title} <span>— {t.artist}</span></div>
                  <div className="bs-pl-why">{t.why}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!full && (
        <div className="bs-sec-sub" style={{ textAlign: "center", padding: "4px 8px" }}>
          {m.name}'s full profile fills in as the season plays out.
        </div>
      )}

      {/* footer */}
      <footer className="bs-footer">
        <div className="bs-footer-mark">the b/side</div>
        <div className="bs-footer-note"><b>{DASH_LEAGUE.name}</b> · one of {m.name}'s leagues · shareable, no login</div>
      </footer>
    </div>
  );
}

Object.assign(window, { ProfileScreen, FingerprintChips });
