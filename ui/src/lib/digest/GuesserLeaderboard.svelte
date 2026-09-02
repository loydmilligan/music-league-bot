<script lang="ts" module>
  // ── guesser-render · Guesser/Storylines redesign (CD handoff §4.1) ─────────
  // Visual form of the frontend-only synthetic 'guesser' section: "The
  // Guesser" — a deterministic ledger of one player's habit of guessing who
  // submitted each song from their vote comments, walked in play order.
  //
  // Renders (top → bottom), all inside the existing DigestSection shell:
  //   1. shared "◆ back of the zine" stamp (shared identity with The Regulars)
  //   2. a legend epigraph, supplied per-league by getGuesserData
  //   3. subhead — this round's record + season average
  //   4. season hit-rate sparkbars + a dashed season-average line (arc-first)
  //   5. the play-order strip — a timeline over a warm→cool gradient, with
  //      landmark annotations mined from his real vote comments. Its labels and
  //      its optional joke marker come from `data.descent`, per league: the
  //      original copy is a drink-deeper descent that is true of SSSC's guesser
  //      and of nobody else.
  //   6. "eludes him" + "littermates" cards, each with a plain-English blurb
  //
  // Deterministic and hover-free: renders IDENTICALLY in web and ?export=1
  // (the flag is threaded through only for parity with ChatMoments). Reads its
  // heavy payload from the `data` prop (visualData = GuesserData), like the
  // 'stats' precedent; `content` is only the optional editable caption.
  //
  // CD designed this on a paper/zine LIGHT surface; per the owner's call we
  // build it DARK-NATIVE using the shipping semantic tokens (--surface, --fg*,
  // --moss, --ember, --mash-pulp*) so it sits consistently inside the current
  // dark digest rather than as a cream island.
  import type { VisualComponentProps } from './variants.js';
  import type { GuesserData, GuesserGuess } from '../db/guesserInsights.js';

  // Legend (D2 · 2b). Credits only the ritual — never who first noticed it.
  // Always present so it survives the exported PNG. Supplied per-league by
  // getGuesserData: the original copy describes a drink-deeper descent that is
  // true of SSSC's guesser and of no one else, so it cannot be hardcoded here.
  const FALLBACK_LEGEND =
    'He guesses the submitter of every song, every round — one drink deeper ' +
    'down the list. Nobody assigned him this. He will not be stopped.';

  // Landmark keyword → icon map (CD §4.1), per league. An annotation fires ONLY
  // when the phrase is present in that round's comment — keeps it honest and
  // varying. Keyed by league because SSSC's landmarks track a drinking descent
  // and would never fire, and never should, on anyone else's ledger.
  const LANDMARK_SETS: Record<string, { icon: string; re: RegExp }[]> = {
    default: [
      { icon: '💧', re: /drink\s+.*water|some water/i },
      { icon: '🚽', re: /bathroom|go (?:use|to) the (?:bathroom|toilet)|\bpee\b/i },
      { icon: '🧠', re: /lost .*coherence|no.*coherence/i },
      { icon: '😴', re: /fell asleep|took over/i },
      { icon: '🍸', re: /another (?:glass|drink)|refill|absinthe/i },
    ],
    // Effort tells, not impairment: the phrases he reaches for when he has
    // stopped working a guess and is just filing something.
    'boarz-ii-men': [
      { icon: '🤷', re: /blind ass guess|blind guess|no idea|wild guess/i },
      { icon: '🔎', re: /process of elimination/i },
      { icon: '🪫', re: /that.?s all i got|not too confident|best i can do/i },
    ],
  };

  /**
   * Caption above the season arc.
   *
   * The strip is capped at the last 10 rounds but `seasonRate` averages the
   * WHOLE season, so a caption of the form "hit-rate over {bars} rounds" sitting
   * next to "season avg N%" claims the average covers only the bars on screen.
   * Once capped we name both sets explicitly instead. Takes the two counts as
   * separate arguments precisely so a caller can't collapse them into one.
   *
   * Exported so it can be unit-tested directly — the numbers here are the whole
   * point, and this section ships with "deterministic · no llm gloss" on it.
   */
  export function seasonArcCaption(shownRounds: number, totalRounds: number): string {
    if (totalRounds > shownRounds) {
      return `the season so far · last ${shownRounds} of ${totalRounds} rounds · average over all ${totalRounds}`;
    }
    return `the season so far · hit-rate over ${totalRounds} rounds`;
  }

  // The marker (where present) is a declared joke, not a measurement: the data
  // has play-ORDER, not clock-TIME. Supplied per league via `data.descent`;
  // null for leagues that get the plain strip.

  type Annotation = { leftPct: number; icon: string; quote: string; pos: number; hit: boolean; place: 'up' | 'dn' };

  // A 170px label centred on a node near either end of the track hangs off the
  // gradient panel and out of the exported frame. Near the edges we anchor the
  // box by its own edge instead and slide the connector line to match, so the
  // line still points at the real node.
  function edgeClass(leftPct: number): '' | 'at-start' | 'at-end' {
    if (leftPct <= 18) return 'at-start';
    if (leftPct >= 82) return 'at-end';
    return '';
  }

  function truncate(s: string, n = 60): string {
    const t = s.trim().replace(/\s+/g, ' ');
    return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
  }

  // Pull the sentence around a landmark keyword out of the full comment, so the
  // annotation shows the actual phrase (e.g. "I need to drink some water") and
  // not the comment's unrelated opening line.
  function landmarkSnippet(comment: string, re: RegExp): string {
    const flat = comment.replace(/\s+/g, ' ').trim();
    const m = re.exec(flat);
    if (!m) return truncate(flat, 44);
    const idx = m.index;
    const start = Math.max(
      flat.lastIndexOf('.', idx),
      flat.lastIndexOf('!', idx),
      flat.lastIndexOf('?', idx),
    );
    let end = flat.length;
    for (const p of ['.', '!', '?']) {
      const e = flat.indexOf(p, idx);
      if (e >= 0) end = Math.min(end, e + 1);
    }
    return truncate(flat.slice(start + 1, end).trim(), 44);
  }
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { content, data }: VisualComponentProps = $props();

  const g = $derived((data ?? null) as GuesserData | null);
  // Instance-scoped: LANDMARK_SETS is a plain module const, but choosing between
  // them depends on `data`, so the selection has to live here.
  const LANDMARKS = $derived(LANDMARK_SETS[g?.leagueSlug ?? ''] ?? LANDMARK_SETS.default);
  const descent = $derived(g?.descent ?? null);
  const marker = $derived(descent?.marker ?? null);
  const fillFrac = $derived(marker?.atFraction ?? 1);
  const caption = $derived((content ?? {}) as { title?: string; body?: string });

  const guesserName = $derived(g?.guesserName ?? null);
  const weekly = $derived(g?.weekly ?? { attempts: 0, correct: 0, rate: 0, guesses: [] });
  const guesses = $derived(weekly.guesses ?? []);
  const seasonHitRates = $derived(g?.seasonHitRates ?? []);
  const seasonRate = $derived(g?.seasonRate ?? 0);
  // How many rounds the average actually covers. Falls back to the bar count so
  // a payload predating `seasonRoundCount` captions "over N rounds" rather than
  // "last N of 0".
  const seasonRoundCount = $derived(Math.max(g?.seasonRoundCount ?? 0, seasonHitRates.length));
  // "Eludes him" (D3): players he's guessed the most and NEVER once gotten right.
  const eludes = $derived((g?.eludesHim ?? []).filter((r) => r.rate === 0));
  const littermates = $derived(g?.littermates ?? null);
  const roster = $derived(g?.roster ?? []);
  // Full per-person history as native tooltip text — no JS, no CSS popover, and
  // it degrades to nothing in print rather than to a broken control.
  const rosterTitle = (r: { name: string; songs: { roundLabel: string; title: string; correct: boolean }[] }) =>
    `${r.name}\n` +
    r.songs.map((sg) => `${sg.correct ? '✓' : '✗'} R${sg.roundLabel} · ${sg.title || 'untitled'}`).join('\n');

  // Difficulty is HAND-ANNOTATED, never inferred: it lives in the section's
  // editable content_json keyed by spotify uri. A detector for "did the
  // submitter give it away in chat" would misfire constantly, and most rounds
  // have no gimmes at all — so the honest default is an unmarked guess.
  const difficulty = $derived(
    ((content ?? {}) as { difficulty?: Record<string, { level?: string; why?: string }> }).difficulty ?? {},
  );
  const marked = $derived(
    (g?.weekly.guesses ?? [])
      .map((gs) => ({ gs, d: difficulty[gs.spotifyUri] }))
      .filter((x) => !!x.d?.level),
  );

  const hasWeekly = $derived(weekly.attempts > 0);
  const playCount = $derived(guesses[0]?.playCount ?? guesses.length);

  function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
  }
  function nodeLeft(pos: number): number {
    if (playCount <= 1) return 50;
    return Math.min(100, Math.max(0, ((pos - 1) / (playCount - 1)) * 100));
  }

  // ── season sparkbars ──────────────────────────────────────────────────────
  // Scale bar heights + the average line against the season's own ceiling so
  // the arc always fills the panel regardless of absolute hit rates.
  const BAR_MAX = 52; // px
  const BAR_MIN = 4;
  const seasonCeil = $derived(
    Math.max(0.01, seasonRate, ...seasonHitRates.map((p) => p.rate)),
  );
  const seasonBars = $derived(
    seasonHitRates.map((p, i) => ({
      label: p.label,
      h: Math.round((p.rate / seasonCeil) * BAR_MAX) + BAR_MIN,
      now: i === seasonHitRates.length - 1,
      title: `${p.label}: ${p.correct}/${p.attempts} (${pct(p.rate)})`,
    })),
  );
  const avgBottom = $derived(Math.round((seasonRate / seasonCeil) * BAR_MAX) + BAR_MIN);

  // ── descent nodes + landmark annotations ────────────────────────────────────
  const nodes = $derived(
    guesses.map((gs: GuesserGuess) => ({ left: nodeLeft(gs.playPosition), hit: gs.correct })),
  );

  // Pick at most a first comment-landmark (placed below the track) and the last
  // correct hit (placed above) — enough to read, never cluttered (CD §4.1).
  const annotations = $derived.by<Annotation[]>(() => {
    const out: Annotation[] = [];
    const firstLandmark = guesses.find(
      (gs: GuesserGuess) => gs.comment != null && LANDMARKS.some((l) => l.re.test(gs.comment!)),
    );
    if (firstLandmark && firstLandmark.comment) {
      const lm = LANDMARKS.find((l) => l.re.test(firstLandmark.comment!))!;
      out.push({
        leftPct: nodeLeft(firstLandmark.playPosition),
        icon: lm.icon,
        quote: landmarkSnippet(firstLandmark.comment, lm.re),
        pos: firstLandmark.playPosition,
        hit: false,
        place: 'dn',
      });
    }
    const hits = guesses.filter((gs: GuesserGuess) => gs.correct);
    const lastHit = hits[hits.length - 1];
    // If the landmark comment IS the last hit, one annotation says both things
    // — a second at the same position would just overprint it.
    if (lastHit && lastHit.playPosition !== firstLandmark?.playPosition) {
      out.push({
        leftPct: nodeLeft(lastHit.playPosition),
        icon: '',
        quote: lastHit.comment ? truncate(lastHit.comment, 42) : `nailed ${lastHit.actualName}`,
        pos: lastHit.playPosition,
        hit: true,
        place: 'up',
      });
    }
    return out;
  });

  // Static (PNG/PDF) export renders identically to web here — the flag is
  // threaded through only for parity with ChatMoments.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
</script>

<div class="gsl" data-component="guesser-render" class:is-export={isExport}>
  {#if !guesserName}
    <p class="gsl-empty">(no guesser detected for this round)</p>
  {:else}
    <span class="gsl-stamp"><span class="s">◆</span>back of the zine · about the people</span>

    <p class="gsl-epigraph">{g?.legend ?? FALLBACK_LEGEND}</p>

    <p class="gsl-subhead">
      {guesserName.toLowerCase()} · <b>{weekly.correct}/{weekly.attempts}</b> this round · season average
      <b>{pct(seasonRate)}</b> · deterministic · no llm gloss
    </p>

    {#if caption.body}<p class="gsl-user-note">{caption.body}</p>{/if}

    <!-- ── season arc (D3 · arc-first) ── -->
    {#if seasonBars.length}
      <div class="gsl-blocklbl">{seasonArcCaption(seasonBars.length, seasonRoundCount)}</div>
      <div class="gsl-spark">
        <div class="gsl-avg" style="bottom:{avgBottom}px"><span>season avg {pct(seasonRate)}</span></div>
        <!-- index keys throughout: round labels are NOT unique (a null
             round_number falls back to the round id), and a duplicate {#each}
             key is a fatal hydration crash that kills the PNG export. -->
        {#each seasonBars as b, i (i)}
          <div class="gsl-bar" class:now={b.now} style="height:{b.h}px" title={b.title}></div>
        {/each}
      </div>
      <div class="gsl-spark-x">
        {#each seasonBars as b, i (i)}<span>{b.label}</span>{/each}
      </div>
    {/if}

    <!-- ── play-order strip (D1 · 2a) ── -->
    {#if hasWeekly && nodes.length}
      <div class="gsl-blocklbl">{descent?.label ?? 'this round · by play order'}</div>
      <div class="gsl-dz">
        <div class="gsl-dz-lbl">
          <span>{descent?.startLabel ?? 'song 1'}</span>
          <span class="r">{(descent?.endLabel ?? 'song {n}').replace('{n}', String(playCount))}</span>
        </div>
        <div class="gsl-tl">
          {#each annotations as a, i (i)}
            <div class="gsl-ann {a.place} {edgeClass(a.leftPct)}" style="left:{a.leftPct}%">
              <div class="q">{a.icon ? `${a.icon} ` : ''}{a.hit ? `"${a.quote}"` : a.quote}</div>
              <div class="p">song {String(a.pos).padStart(2, '0')}{a.hit ? ' · hit' : ''}</div>
            </div>
          {/each}
          <div class="gsl-track">
            <div class="gsl-fill" style="right:{Math.round((1 - fillFrac) * 100)}%"></div>
            {#if marker}
              <div class="gsl-nodrive" style="left:{Math.round(marker.atFraction * 100)}%">
                <span class="lab">{marker.label}</span>
              </div>
            {/if}
            {#each nodes as n, i (i)}
              <div class="gsl-node" class:hit={n.hit} class:miss={!n.hit} style="left:{n.left}%"></div>
            {/each}
          </div>
        </div>
        {#if marker}
          <p class="gsl-descap">{marker.caption}</p>
          <p class="gsl-caveat"><b>{marker.caveat}</b></p>
        {/if}
      </div>
    {/if}

    <!-- ── roster strip: who he actually catches ── -->
    {#if roster.length}
      <div class="gsl-blocklbl">the roster · season hit-rate, and this round</div>
      <div class="gsl-roster">
        {#each roster as r, i (i)}
          <div class="gsl-rr" title={rosterTitle(r)}>
            <span class="nm">{r.name}</span>
            <!-- One segment per attempt rather than a single filled bar: the bar
                 IS the breakdown, so it survives the export where a hover
                 tooltip would not. The title adds the song name on top. -->
            <span class="bar">
              {#each r.songs as sg, si (si)}
                <i
                  class:hit={sg.correct}
                  style="width:{100 / r.songs.length}%"
                  title={`R${sg.roundLabel} · ${sg.title || 'untitled'} — ${sg.correct ? 'got it' : 'missed'}`}
                ></i>
              {/each}
            </span>
            <span class="pc">{Math.round(r.rate * 100)}%</span>
            <span class="n">{r.correct}/{r.attempts}</span>
            <span class="tr" class:hit={r.thisRound === true} class:miss={r.thisRound === false}
              title={r.thisRound === null ? 'no attempt this round' : r.thisRound ? 'caught this round' : 'missed this round'}
            >{r.thisRound === null ? '·' : r.thisRound ? '●' : '○'}</span>
          </div>
        {/each}
      </div>
      <p class="gsl-miniexp">
        bar is his season hit-rate against that person; the dot is this round — filled if he got them,
        hollow if he missed, a dash if they weren't in the round.
      </p>
    {/if}

    {#if marked.length}
      <p class="gsl-miniexp gsl-gimmes">
        marked this round:
        {#each marked as m, i (i)}<span class="gm">{m.gs.actualName} — {m.d?.level}{m.d?.why ? ` (${m.d.why})` : ''}</span>{/each}
      </p>
    {/if}

    <!-- ── eludes + littermates (D3) ── -->
    <div class="gsl-minirow">
      <div class="gsl-mini">
        <h5>eludes him</h5>
        <p class="gsl-miniexp">players he's guessed the most times and <b>never once</b> gotten right — all season.</p>
        {#if eludes.length}
          {#each eludes.slice(0, 3) as row, i (i)}
            <div class="gsl-r"><span>{row.name}</span><span class="n">{row.correct}/{row.attempts}</span></div>
          {/each}
          {#if eludes.length > 3}
            <div class="gsl-r gsl-r--more"><span>+ {eludes.slice(3).map((r) => r.name).join(', ')}</span></div>
          {/if}
        {:else}
          <p class="gsl-empty">(nobody's fully eluded him yet)</p>
        {/if}
      </div>
      <div class="gsl-mini">
        <h5>littermates</h5>
        <p class="gsl-miniexp">the two players he most often <b>mixes up for each other</b> — swapping their names back and forth.</p>
        {#if littermates}
          <div class="gsl-litter">
            <span>{littermates.aName}</span>
            <span class="sw">⇄ ×{littermates.swaps}</span>
            <span>{littermates.bName}</span>
          </div>
        {:else}
          <p class="gsl-empty">(no recurring mix-up this season)</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .gsl {
    display: flex;
    flex-direction: column;
    gap: 0;
    font-family: var(--font-body);
  }
  .gsl-empty {
    margin: 0;
    color: var(--fg-quiet);
    font: 400 12px/1.5 var(--font-body);
    font-style: italic;
  }

  /* shared stamp (D5 · d5b) */
  .gsl-stamp {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 7px;
    margin-bottom: 14px;
    padding: 5px 11px;
    border: 1.5px solid var(--mash-pulp-edge);
    border-radius: 999px;
    /* CD drew the stamp's text in --mash-pulp-edge on light paper; at 8.5px on
       the dark surface that reads ~2:1. Edge stays on the border (as digest.css
       uses it), the text steps up to full pulp. */
    color: var(--mash-pulp);
    font: 700 8.5px/1 var(--font-mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    transform: rotate(-1.5deg);
  }
  /* the ◆ is the shared-identity mark echoed by The Regulars — keep it pulp,
     not a Guesser-only accent, so the two stamps stay the same object. */
  .gsl-stamp .s { color: var(--mash-pulp); }

  /* legend + subhead */
  .gsl-epigraph {
    margin: 0 0 12px;
    max-width: 60ch;
    color: var(--fg);
    font: 500 13px/1.5 var(--font-display);
    font-style: italic;
    letter-spacing: -0.01em;
  }
  .gsl-subhead {
    margin: 0 0 6px;
    color: var(--fg-quiet);
    font: 400 11px/1.45 var(--font-mono);
  }
  .gsl-subhead b { color: var(--mash-pulp); font-weight: 700; }
  .gsl-user-note {
    margin: 8px 0 0;
    color: var(--fg-2);
    font: 500 12px/1.5 var(--font-body);
    white-space: pre-wrap;
  }

  .gsl-blocklbl {
    margin: 22px 0 10px;
    color: var(--fg-muted);
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  /* season sparkbars */
  .gsl-spark {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 60px;
    margin-top: 4px;
  }
  .gsl-bar {
    flex: 1;
    min-height: 3px;
    background: var(--line-strong);
    border-radius: 2px 2px 0 0;
  }
  .gsl-bar.now { background: var(--mash-pulp); }
  .gsl-avg {
    position: absolute;
    left: 0;
    right: 0;
    /* CD's dashed line is a *dimmer* pulp than the current-round bar so the two
       read apart. On light paper that was --mash-pulp-edge; on dark, dimming
       means mixing toward the surface, not toward black. */
    border-top: 1px dashed color-mix(in srgb, var(--mash-pulp) 60%, var(--surface));
    z-index: 1;
  }
  .gsl-avg span {
    position: absolute;
    right: 0;
    top: -13px;
    color: color-mix(in srgb, var(--mash-pulp) 75%, var(--fg-muted));
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .gsl-spark-x {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    color: var(--fg-quiet);
    font: 600 8px/1 var(--font-mono);
  }
  .gsl-spark-x span { flex: 1; text-align: center; }

  .gsl-roster { display: grid; gap: 3px; margin: 2px 0 6px; }
  .gsl-rr { display: grid; grid-template-columns: 8.5em 1fr 2.6em 2.8em 1em; gap: 8px; align-items: center; font-size: 12px; }
  .gsl-rr .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gsl-rr .bar { display: flex; gap: 1px; background: rgba(0,0,0,.06); border-radius: 3px; height: 9px; overflow: hidden; }
  /* miss = ember, hit = moss; both muted so the strip reads as one object */
  .gsl-rr .bar i { display: block; height: 100%; background: rgb(190, 90, 70); opacity: .75; }
  .gsl-rr .bar i.hit { background: rgb(90, 140, 95); opacity: .9; }
  .gsl-rr .pc, .gsl-rr .n { text-align: right; font-variant-numeric: tabular-nums; opacity: .7; }
  .gsl-rr .tr { text-align: center; opacity: .35; }
  .gsl-rr .tr.hit { opacity: 1; }
  .gsl-rr .tr.miss { opacity: .75; }
  .gsl-gimmes .gm { display: inline-block; margin-right: 10px; }

  /* play-order timeline; the gradient is decorative and carries no unit */
  .gsl-dz {
    position: relative;
    padding: 30px 22px 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    /* moss-tint → pulp-tint → ember-tint, mixed from the
       shipping tokens rather than the mock's raw hexes. */
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--moss) 10%, transparent) 0%,
        color-mix(in srgb, var(--mash-pulp) 6%, transparent) 45%,
        color-mix(in srgb, var(--ember) 22%, transparent) 100%
      ),
      var(--surface);
  }
  .gsl-dz-lbl {
    display: flex;
    justify-content: space-between;
    margin-bottom: 14px;
    color: var(--fg-quiet);
    font: 700 8.5px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .gsl-dz-lbl .r { color: var(--ember); }
  .gsl-tl { position: relative; }
  .gsl-track {
    position: relative;
    height: 3px;
    margin: 64px 0;
    background: var(--line-strong);
    border-radius: 2px;
  }
  .gsl-fill {
    position: absolute;
    inset: 0 45% 0 0;
    background: linear-gradient(90deg, var(--line-strong), var(--mash-pulp));
    border-radius: 2px;
  }
  .gsl-node {
    position: absolute;
    top: 50%;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid var(--bg);
  }
  .gsl-node.miss { background: var(--line-strong); }
  .gsl-node.hit { width: 15px; height: 15px; background: var(--moss); }
  .gsl-ann {
    position: absolute;
    width: 170px;
    text-align: center;
    transform: translateX(-50%);
  }
  .gsl-ann .q { color: var(--fg); font: 500 11px/1.35 var(--font-display); font-style: italic; }
  .gsl-ann .p {
    margin-top: 3px;
    color: var(--mash-pulp);
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .gsl-ann.up { bottom: calc(50% + 18px); }
  .gsl-ann.dn { top: calc(50% + 18px); }
  .gsl-ann::after {
    content: '';
    position: absolute;
    left: 50%;
    width: 1px;
    background: var(--line-strong);
  }
  .gsl-ann.up::after { top: 100%; height: 14px; }
  .gsl-ann.dn::after { bottom: 100%; height: 14px; }
  /* edge-anchored labels — the box hugs the panel, the connector keeps pointing
     at the actual node (see edgeClass). */
  .gsl-ann.at-start { transform: translateX(-14px); text-align: left; }
  .gsl-ann.at-start::after { left: 14px; }
  .gsl-ann.at-end { transform: translateX(calc(-100% + 14px)); text-align: right; }
  .gsl-ann.at-end::after { left: calc(100% - 14px); }
  .gsl-nodrive {
    position: absolute;
    top: -26px;
    bottom: -26px;
    width: 0;
    border-left: 2px dashed var(--ember);
    z-index: 2;
  }
  .gsl-nodrive .lab {
    position: absolute;
    top: -16px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    padding: 3px 6px;
    background: var(--bg);
    border: 1px solid var(--ember);
    border-radius: 5px;
    color: var(--ember);
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .gsl-descap {
    margin: 10px 0 0;
    color: var(--fg-quiet);
    font: 400 10.5px/1.45 var(--font-mono);
  }
  .gsl-caveat {
    margin: 14px 0 0;
    color: var(--fg-quiet);
    font: 400 9.5px/1.45 var(--font-mono);
    font-style: italic;
  }
  .gsl-caveat b { color: var(--fg-muted); font-weight: 700; font-style: normal; }

  /* eludes + littermates */
  .gsl-minirow {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 22px;
  }
  .gsl-mini {
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .gsl-mini h5 {
    margin: 0 0 8px;
    color: var(--fg-muted);
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .gsl-miniexp {
    margin: 0 0 12px;
    color: var(--fg-muted);
    font: 400 11px/1.42 var(--font-body);
  }
  .gsl-miniexp b { color: var(--fg); font-weight: 700; }
  .gsl-r {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    color: var(--fg-2);
    font: 500 12px/1.7 var(--font-body);
  }
  .gsl-r .n {
    color: var(--fg-quiet);
    font: 700 11px/1.7 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .gsl-r--more span { color: var(--fg-muted); font-size: 11px; font-style: italic; }
  .gsl-litter {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
    color: var(--fg);
    font: 700 14px/1.2 var(--font-display);
  }
  .gsl-litter .sw {
    padding: 4px 8px;
    background: var(--mash-pulp-soft);
    border-radius: 999px;
    color: var(--mash-pulp);
    font: 700 11px/1 var(--font-mono);
  }

  /* ── 430px reflow ─────────────────────────────────────────────────────────
     Two 170px annotations collide inside a 430px frame, so drop to one: the
     first one printed stays (the landmark when there is one, otherwise the
     hit); the dropped one is still legible as a node on the track. Applied by
     viewport AND by the .dg-export--mobile frame class, since the mobile PNG is
     rendered in a wide viewport. */
  @media (max-width: 460px) {
    .gsl-minirow { grid-template-columns: 1fr; }
    .gsl-ann { width: 130px; }
    .gsl-ann + .gsl-ann { display: none; }
    .gsl-spark { gap: 3px; }
    .gsl-spark-x { font-size: 7px; }
  }
  :global(.dg-export--mobile) .gsl-minirow { grid-template-columns: 1fr; }
  :global(.dg-export--mobile) .gsl-ann { width: 130px; }
  :global(.dg-export--mobile) .gsl-ann + .gsl-ann { display: none; }
  :global(.dg-export--mobile) .gsl-spark { gap: 3px; }
  :global(.dg-export--mobile) .gsl-spark-x { font-size: 7px; }
</style>
