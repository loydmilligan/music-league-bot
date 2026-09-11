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
  import { buildSeasonPanel, MIN_RATE_SAMPLE } from './guesserSeason.js';

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
  // The room's ledger. Rows with zero attempts are KEPT: four Boarz players have
  // never once named a submitter, and that is the finding, not missing data.
  const grid = $derived(g?.seasonGrid ?? { rounds: [], rows: [] });
  const gridSilent = $derived(grid.rows.filter((r) => r.attempts === 0));
  const maxAttempts = $derived(Math.max(1, ...grid.rows.map((r) => r.attempts)));
  const gridNotes = $derived(
    grid.rows.flatMap((r) =>
      r.cells.filter((c) => !!c?.note).map((c) => ({ name: r.name, note: c!.note as string })),
    ),
  );
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

  // ── the season panel ──────────────────────────────────────────────────────
  // Four tabs over one dataset, all of it derived in guesserSeason.ts so the
  // numbers are unit-tested away from the markup.
  const panel = $derived(buildSeasonPanel(grid, g?.leagueSlug ?? ''));
  const TABS = ['By player', 'Field', 'Carrot box', 'Targets'];
  let tab = $state(0);
  // The exported PNG captures the DOM as it stands, so there is nothing to
  // click: the four panels stack, each naming itself (handoff D5).
  const showTab = (i: number) => isExport || tab === i;

  // Identity hues for the ⊙ pips: the ring says WHO guessed you, the fill says
  // whether they were right. Assigned by guessing volume, which is the order
  // the grid rows already come in, so the busiest guessers get the strongest
  // hues. Beyond six guessers the ring goes neutral rather than start repeating
  // colours — a wrong identity reads worse than none.
  const ID_PALETTE = [
    'var(--mash-pulp)',
    'var(--sky)',
    'var(--amber)',
    'var(--moss)',
    'var(--ember)',
    'var(--violet)',
  ];
  const idHues = $derived(
    new Map(
      grid.rows
        .filter((r) => r.attempts > 0)
        .map((r, i) => [r.name, ID_PALETTE[i] ?? 'var(--fg-muted)'] as const),
    ),
  );
  const hueOf = (name: string) => idHues.get(name) ?? 'var(--fg-muted)';
  const idLegend = $derived(
    grid.rows
      .filter((r) => r.attempts > 0)
      .map((r) => ({
        name: r.name,
        short: panel.cards.find((c) => c.name === r.name)?.short ?? r.name,
        hue: hueOf(r.name),
      })),
  );

  // Field geometry. x is already 0–1 (root-scaled); 3–95% keeps the busiest
  // guesser's dot and its label inside the frame.
  const dotLeft = (d: { x: number }) => +(3 + d.x * 92).toFixed(1);
  const dotBottom = (d: { y: number }) => +(d.y * 100).toFixed(1);
  // The shaded column is the small-sample rule drawn where it falls on this
  // axis — not a hand-placed "about here".
  const thinWidthPct = $derived(dotLeft({ x: Math.sqrt(MIN_RATE_SAMPLE / maxAttempts) }));

  // Carrot box: the awards and the bars are computed, but the decoy EVIDENCE is
  // a judgement about one comment, so it only ever comes from the section's
  // editable content — never from a hardcoded quote in here.
  const carrot = $derived(
    ((content ?? {}) as {
      carrot?: {
        ghostLine?: string;
        decoyLine?: string;
        quote?: string;
        quoteEyebrow?: string;
        quoteCaption?: string;
      };
    }).carrot ?? {},
  );
  const throwOffMax = $derived(Math.max(1, ...panel.throwOffs.map((t) => t.misses)));
  const swapCount = $derived(
    panel.interchangeables ? panel.interchangeables.spokes.reduce((n, s) => n + s.count, 0) : 0,
  );
  const swapShare = $derived(
    panel.totalMisses ? `${Math.round((swapCount / panel.totalMisses) * 100)}%` : '—',
  );
  // One line per blurted guess, capped at eight: past that the fan stops being
  // countable and the number beside the node carries the fact anyway.
  const blurtLines = $derived.by<number[]>(() => {
    const n = Math.min(panel.defaultGuess?.count ?? 0, 8);
    if (n <= 1) return n === 1 ? [84] : [];
    return Array.from({ length: n }, (_, i) => 20 + (i * 128) / (n - 1));
  });
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

    <!-- ── the room's ledger · the season panel (CD handoff: guesser-viz) ── -->
    {#if panel.cards.length > 1}
      <div class="gsl-sp">
        <h5>everyone who's ever guessed</h5>
        <p class="gsl-miniexp">who plays, how often, and how well — all season.</p>

        {#if !isExport}
          <div class="gsl-sp-tabs" role="tablist">
            {#each TABS as t, i (t)}
              <button
                type="button"
                role="tab"
                class="gsl-sp-tab"
                class:on={tab === i}
                aria-selected={tab === i}
                onclick={() => (tab = i)}>{t}</button>
            {/each}
          </div>
        {/if}

        <!-- ── 1 · by player ─────────────────────────────────────────────── -->
        {#if showTab(0)}
          <div class="gsl-sp-panel">
            {#if isExport}<div class="gsl-sp-h">{TABS[0]}</div>{/if}
            <p class="gsl-sp-lede">
              each player, both directions — <b>▶ how they guess</b> and
              <b>⊙ how they're guessed</b>. hover any dot for the round-by-round detail.
            </p>
            <div class="gsl-sp-key">
              <span class="k"><i class="pip moss"></i>right</span>
              <span class="k"><i class="pip ember"></i>wrong</span>
              <span class="k"><i class="pip out"></i>sat out</span>
              <span class="rule"></span>
              <span class="note">⊙ guessed-at pips — <b>ring colour = who guessed you</b>, pale fill = right/wrong:</span>
              {#each idLegend as l (l.name)}
                <span class="k"><i class="pip ring" style="border-color:{l.hue}"></i>{l.short}</span>
              {/each}
            </div>
            <div class="gsl-sp-cards">
              {#each panel.cards as c (c.playerId)}
                <div class="gsl-sp-card">
                  <div class="hd">
                    <span class="nm">{c.short}</span>
                    <span class="fig {c.figureTone}">{c.figure}</span>
                  </div>
                  <div class="lbl">▶ guessing</div>
                  {#if c.attempts === 0}
                    <p class="gsl-sp-none">didn't play</p>
                  {:else}
                    <div class="pips">
                      {#each c.cells as cell, i (i)}
                        <i class="pip {cell.tone}" class:halo={cell.overridden} title={cell.title}></i>
                      {/each}
                    </div>
                  {/if}
                  <div class="lbl">⊙ guessed</div>
                  {#if c.incoming.length === 0}
                    <p class="gsl-sp-none">no one's guessed at you yet</p>
                  {:else}
                    <div class="pips wrap">
                      {#each c.incoming as inc, i (i)}
                        <i
                          class="pip inc"
                          class:right={inc.correct}
                          style="border-color:{hueOf(inc.guesser)}"
                          title={inc.title}></i>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- ── 2 · the field ─────────────────────────────────────────────── -->
        {#if showTab(1)}
          <div class="gsl-sp-panel">
            {#if isExport}<div class="gsl-sp-h">{TABS[1]}</div>{/if}
            <p class="gsl-sp-lede">
              <b>Guessing skill.</b> where every guesser lands — reps across, accuracy up.
              the four corners name the kind of guesser you are.
            </p>
            <div class="gsl-sp-plot">
              <span class="ax y top">100%</span>
              <span class="ax y mid">50%</span>
              <span class="ax y bot">0%</span>
              <div class="frame"></div>
              <div class="shade" style="width:{thinWidthPct}%"></div>
              <div class="vmid" style="left:{thinWidthPct}%"></div>
              <div class="hmid"></div>
              <span class="corner tl">lucky?<br /><span>small sample</span></span>
              <span class="corner tr">sharp eye</span>
              <span class="corner bl">dabblers</span>
              <span class="corner br">puts in reps</span>
              {#each panel.field as d, i (i)}
                <span
                  class="dot {d.tone}"
                  class:thin={d.thin}
                  style="left:{dotLeft(d)}%; bottom:{dotBottom(d)}%"
                  title={d.title}></span>
                <span
                  class="dlab"
                  class:right={dotLeft(d) > 62}
                  class:thin={d.thin}
                  class:low={dotBottom(d) < 10}
                  style="left:{dotLeft(d)}%; bottom:{dotBottom(d)}%">
                  <b>{d.label}</b>
                  <em>{d.correct}/{d.attempts}{d.thin ? '' : ` · ${pct(d.rate)}`}</em>
                </span>
              {/each}
            </div>
            <div class="gsl-sp-xax">guesses made →</div>
            <p class="gsl-sp-take">
              Above the dashed line is better than a coin flip. Left of it is
              <span class="em">too little evidence to say</span> — under {MIN_RATE_SAMPLE} guesses
              a percentage is a coin toss wearing a number.
            </p>
          </div>
        {/if}

        <!-- ── 3 · carrot box ────────────────────────────────────────────── -->
        {#if showTab(2)}
          <div class="gsl-sp-panel">
            {#if isExport}<div class="gsl-sp-h">{TABS[2]}</div>{/if}
            <p class="gsl-sp-lede">
              <b class="pulp">Carrot boxing</b> — throwing the room off your scent in the comments
              and the chat, so they peg your song as someone else's and vote it down for it.
              Two ways to vanish: say nothing, or plant a decoy.
            </p>
            {#if panel.ghost && panel.transparent}
              <div class="gsl-sp-awards">
                <div class="aw ghost">
                  <div class="eyebrow">◆ the ghost</div>
                  <div class="who">{panel.ghost.short}</div>
                  <p>
                    {panel.ghost.attempts} guesses aimed at them, spotted
                    <b class="ember">{panel.ghost.correct === 0 ? 'zero' : panel.ghost.correct}</b>
                    {panel.ghost.correct === 1 ? 'time' : 'times'}.
                    {carrot.ghostLine ?? 'Hardest man in the room to name.'}
                  </p>
                </div>
                <div class="aw decoy">
                  <div class="eyebrow">◆ the open book</div>
                  <div class="who">{panel.transparent.short}</div>
                  <p>
                    Spotted {panel.transparent.correct} of {panel.transparent.attempts} —
                    {carrot.decoyLine ?? "the room reads him on sight, unless he plants a fake."}
                  </p>
                </div>
              </div>
            {/if}

            {#if carrot.quote}
              <div class="gsl-sp-quote">
                <div class="eyebrow">{carrot.quoteEyebrow ?? 'planted decoy · caught in the act'}</div>
                <p class="q">“{carrot.quote}”</p>
                {#if carrot.quoteCaption}<p class="cap">{carrot.quoteCaption}</p>{/if}
                <p class="flag">flagged by hand · needs a comment-flag field in the feed</p>
              </div>
            {/if}

            {#if panel.throwOffs.length}
              <div class="gsl-sp-sub">threw the room off — times misidentified</div>
              {#each panel.throwOffs as t (t.name)}
                <div class="gsl-sp-torow">
                  <span class="nm">{t.short}</span>
                  <span class="track"><span class="fill" style="width:{(t.misses / throwOffMax) * 100}%"></span></span>
                  <span class="n">{t.misses}×</span>
                </div>
              {/each}
              <p class="gsl-sp-foot">
                Whether a throw-off actually <b>cost</b> them votes needs each guess joined to that
                guesser's ballot — not in the feed yet, so it isn't drawn.
              </p>
            {/if}

            {#if panel.interchangeables || panel.defaultGuess}
              <div class="gsl-sp-div"><span>why the throws land</span><i></i></div>
            {/if}

            {#if panel.interchangeables}
              <div class="gsl-sp-sub">1 · the interchangeables</div>
              <svg class="gsl-sp-svg" viewBox="0 0 360 152" width="100%" aria-hidden="true">
                {#each panel.interchangeables.spokes as sp, i (sp.name)}
                  <path
                    d={i === 0 ? 'M70,118 Q120,52 183,40' : 'M300,118 Q250,52 187,40'}
                    fill="none"
                    stroke="var(--mash-pulp)"
                    stroke-width="7"
                    stroke-linecap="round"
                    opacity="0.9" />
                  <circle cx={i === 0 ? 70 : 300} cy="122" r="8" fill="var(--ember-soft)" stroke="var(--ember)" stroke-width="1.4" />
                  <text x={i === 0 ? 70 : 300} y="145" text-anchor="middle" class="t-name">{sp.name}</text>
                  <text x={i === 0 ? 120 : 252} y="70" text-anchor="middle" class="t-count">{sp.count}×</text>
                {/each}
                <circle cx="185" cy="38" r="9" fill="var(--mash-pulp)" />
                <text x="185" y="22" text-anchor="middle" class="t-hub">{panel.interchangeables.hub}</text>
              </svg>
              <p class="gsl-sp-cap">
                {swapCount} swaps between {panel.interchangeables.spokes.length + 1} men — {swapShare} of
                the season's misses.
              </p>
            {/if}

            {#if panel.defaultGuess}
              <div class="gsl-sp-sub">2 · the default guess</div>
              <svg class="gsl-sp-svg" viewBox="0 0 360 168" width="100%" aria-hidden="true">
                {#each blurtLines as y, i (i)}
                  <line x1="46" y1={y} x2="278" y2="84" stroke="var(--mash-pulp)" stroke-width="1.6" opacity="0.4" />
                {/each}
                <circle cx="304" cy="84" r="26" fill="var(--mash-pulp)" />
                <text x="304" y="82" text-anchor="middle" class="t-node">{panel.defaultGuess.short}</text>
                <text x="304" y="96" text-anchor="middle" class="t-nodenum">{panel.defaultGuess.count}×</text>
                <text x="8" y="12" class="t-axis">every stumped guess →</text>
              </svg>
              <p class="gsl-sp-cap">
                “{panel.defaultGuess.short}” is the name people blurt on <b>others'</b> songs when
                stumped — {panel.defaultGuess.count}× wrong. (Different from the Targets tab, which
                is how often <b>his own</b> songs get pegged.)
              </p>
            {/if}
          </div>
        {/if}

        <!-- ── 4 · targets ───────────────────────────────────────────────── -->
        {#if showTab(3)}
          <div class="gsl-sp-panel">
            {#if isExport}<div class="gsl-sp-h">{TABS[3]}</div>{/if}
            <p class="gsl-sp-q">When a song is yours, how often does the room name you right?</p>
            <p class="gsl-sp-sublede">
              <b>Being guessed.</b> every guess anyone aimed at you, all season · anonymous at top
            </p>
            {#each panel.targets as t (t.name)}
              <div class="gsl-sp-trow">
                <span class="nm">{t.short}</span>
                <span class="mid">
                  <span class="track"><span class="fill {t.tone}" style="width:{t.rate * 100}%"></span></span>
                  {#if t.mistakenFor}<span class="mis">mistaken for <b>{t.mistakenFor}</b></span>{/if}
                </span>
                <span class="num"><b class={t.tone}>{pct(t.rate)}</b> <em>{t.correct}/{t.attempts}</em></span>
              </div>
            {/each}
            {#if panel.targetsHeldBack.length}
              <p class="gsl-sp-foot">
                Left out: {panel.targetsHeldBack.map((h) => `${h.short} (${h.attempts})`).join(', ')} —
                too few songs of theirs have ever been guessed at to give a rate.
              </p>
            {/if}
          </div>
        {/if}

        {#if gridSilent.length}
          <p class="gsl-silent">
            never once guessed, all season: <b>{gridSilent.map((r) => r.name).join(', ')}</b>
          </p>
        {/if}
        {#each gridNotes as n, i (i)}
          <p class="gsl-gridnote"><b>{n.name}</b> {n.note}</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* ── the season panel ──────────────────────────────────────────────────
     Four tabs over one dataset, read as the section widening from one player
     to the whole room. Two directions are kept visually separate everywhere:
     GUESSING is bright/solid, being GUESSED is a pale fill inside a ring
     coloured by whoever did the guessing. Colour is never the only channel —
     every pip carries the same fact in its title, and every rate is printed
     next to its raw count. */
  .gsl-sp {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--rule, rgba(255, 255, 255, 0.12));
  }
  .gsl-sp h5 {
    margin: 0 0 4px;
    font: 700 15px/1.2 var(--font-display);
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .gsl-sp-tabs {
    display: flex;
    gap: 2px;
    margin-top: 14px;
    border-bottom: 1px solid var(--line);
  }
  .gsl-sp-tab {
    flex: 1;
    appearance: none;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    padding: 10px 2px;
    font: 400 9px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
  }
  .gsl-sp-tab:hover {
    color: var(--fg-2);
  }
  .gsl-sp-tab.on {
    color: var(--mash-pulp);
    border-bottom-color: var(--mash-pulp);
  }
  .gsl-sp-panel {
    padding-top: 12px;
  }
  /* In the exported PNG there are no tabs to click, so the four panels stack
     and each one names itself. */
  .gsl-sp-h {
    margin: 18px 0 8px;
    font: 400 9px/1 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mash-pulp);
  }
  .gsl-sp-lede {
    margin: 2px 0 10px;
    font: 400 11.5px/1.5 var(--font-body);
    color: var(--fg-muted);
  }
  .gsl-sp-lede b {
    color: var(--fg-2);
  }
  .gsl-sp-lede b.pulp {
    color: var(--mash-pulp);
  }
  .gsl-sp-none {
    margin: 5px 0 0;
    font: italic 400 9px/1.4 var(--font-body);
    color: var(--fg-quiet);
  }

  /* ── pips (shared by the legend and the cards) ── */
  .gsl-sp .pip {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .gsl-sp .pip.moss {
    background: var(--moss);
  }
  .gsl-sp .pip.amber {
    background: var(--amber);
  }
  .gsl-sp .pip.ember {
    background: var(--ember);
  }
  .gsl-sp .pip.out {
    border: 1px solid var(--line-strong);
  }
  .gsl-sp .pip.halo {
    box-shadow: 0 0 0 2px var(--amber-soft);
  }
  .gsl-sp .pip.ring,
  .gsl-sp .pip.inc {
    width: 10px;
    height: 10px;
    border: 2px solid var(--fg-muted);
    background: var(--ember-soft);
  }
  .gsl-sp .pip.inc.right {
    background: var(--moss-soft);
  }

  .gsl-sp-key {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-bottom: 14px;
    padding: 9px 11px;
    background: var(--ink-1);
    border: 1px solid var(--line);
    border-radius: 9px;
    font: 400 9px/1 var(--font-body);
    color: var(--fg-muted);
  }
  .gsl-sp-key .k {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .gsl-sp-key .rule {
    width: 100%;
    height: 1px;
    background: var(--line);
    margin: 1px 0;
  }
  .gsl-sp-key .note {
    width: 100%;
    color: var(--fg-quiet);
    line-height: 1.4;
  }
  .gsl-sp-key .note b {
    color: var(--fg-muted);
  }

  /* ── tab 1 · by player ── */
  .gsl-sp-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .gsl-sp-card {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-4, 10px);
    padding: 11px 12px;
  }
  .gsl-sp-card .hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
  }
  .gsl-sp-card .nm {
    font: 700 14px/1.1 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-card .fig {
    font: 400 10px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .gsl-sp-card .fig.moss {
    color: var(--moss);
  }
  .gsl-sp-card .fig.amber {
    color: var(--amber);
  }
  .gsl-sp-card .fig.ember {
    color: var(--ember);
  }
  .gsl-sp-card .fig.quiet {
    color: var(--fg-quiet);
  }
  .gsl-sp-card .lbl {
    margin-top: 9px;
    font: 400 7.5px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .gsl-sp-card .pips {
    display: flex;
    gap: 3px;
    margin-top: 5px;
  }
  .gsl-sp-card .pips.wrap {
    flex-wrap: wrap;
  }

  /* ── tab 2 · the field ── */
  .gsl-sp-plot {
    position: relative;
    height: 290px;
    margin: 4px 0 20px 26px;
  }
  .gsl-sp-plot .frame {
    position: absolute;
    inset: 0;
    border-left: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
  }
  .gsl-sp-plot .ax {
    position: absolute;
    left: -26px;
    font: 400 9px/1 var(--font-mono);
    color: var(--fg-quiet);
  }
  .gsl-sp-plot .ax.top {
    top: -4px;
  }
  .gsl-sp-plot .ax.mid {
    top: calc(50% - 4px);
  }
  .gsl-sp-plot .ax.bot {
    bottom: -4px;
  }
  /* The shaded column is not decoration: it is exactly the small-sample rule
     the rest of the section obeys, drawn where it falls on this axis. */
  .gsl-sp-plot .shade {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--ember);
    opacity: 0.06;
  }
  .gsl-sp-plot .vmid {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px dashed var(--line);
  }
  .gsl-sp-plot .hmid {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px dashed var(--line);
  }
  .gsl-sp-plot .corner {
    position: absolute;
    font: 400 8px/1.35 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .gsl-sp-plot .corner.tl {
    left: 4px;
    top: 6px;
    color: var(--ember);
    opacity: 0.85;
  }
  .gsl-sp-plot .corner.tl span {
    color: var(--fg-quiet);
  }
  .gsl-sp-plot .corner.tr {
    right: 6px;
    top: 6px;
    text-align: right;
    color: var(--moss);
  }
  .gsl-sp-plot .corner.bl {
    left: 4px;
    bottom: 22px;
  }
  .gsl-sp-plot .corner.br {
    right: 6px;
    bottom: 22px;
    text-align: right;
    color: var(--fg-muted);
  }
  .gsl-sp-plot .dot {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transform: translate(-50%, 50%);
  }
  .gsl-sp-plot .dot.moss {
    background: var(--moss);
    box-shadow: 0 0 0 3px var(--moss-soft);
  }
  .gsl-sp-plot .dot.amber {
    background: var(--amber);
    box-shadow: 0 0 0 3px var(--amber-soft);
  }
  .gsl-sp-plot .dot.ember {
    background: var(--ember);
    box-shadow: 0 0 0 3px var(--ember-soft);
  }
  .gsl-sp-plot .dot.quiet {
    background: var(--fg-quiet);
    opacity: 0.6;
  }
  .gsl-sp-plot .dot.thin {
    width: 10px;
    height: 10px;
  }
  .gsl-sp-plot .dlab {
    position: absolute;
    transform: translate(0, 50%);
    margin-left: 13px;
    white-space: nowrap;
    line-height: 1.25;
  }
  .gsl-sp-plot .dlab.right {
    transform: translate(-100%, 50%);
    margin-left: -13px;
    text-align: right;
  }
  .gsl-sp-plot .dlab b {
    display: block;
    font: 700 12px/1.2 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-plot .dlab em {
    font: 400 9px/1 var(--font-mono);
    font-style: normal;
    color: var(--fg-muted);
  }
  .gsl-sp-plot .dlab.thin b {
    font: 400 10px/1.2 var(--font-body);
    color: var(--fg-2);
  }
  /* A merged small-sample dot sits mid-plot, where a label beside it lands on
     the 50% line; under the dot is the only clear space. */
  .gsl-sp-plot .dlab.thin {
    transform: translate(-50%, 120%);
    margin-left: 0;
    text-align: center;
  }
  /* A player at 0% sits ON the axis, where the label would print over the
     x-axis caption. */
  .gsl-sp-plot .dlab.low {
    transform: translate(0, -15%);
  }
  .gsl-sp-plot .dlab.low.right {
    transform: translate(-100%, -15%);
  }
  .gsl-sp-xax {
    margin-top: -6px;
    text-align: center;
    font: 400 9px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .gsl-sp-take {
    margin: 14px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    font: 400 11.5px/1.5 var(--font-body);
    color: var(--fg-muted);
  }
  .gsl-sp-take .em {
    color: var(--ember);
  }

  /* ── tab 3 · carrot box ── */
  .gsl-sp-awards {
    display: flex;
    gap: 9px;
    margin-bottom: 18px;
  }
  .gsl-sp-awards .aw {
    flex: 1;
    border-radius: 12px;
    padding: 12px 13px;
  }
  .gsl-sp-awards .aw.ghost {
    background: linear-gradient(180deg, var(--amber-soft), transparent);
    border: 1px solid var(--amber);
  }
  .gsl-sp-awards .aw.decoy {
    background: linear-gradient(180deg, var(--sky-soft), transparent);
    border: 1px solid var(--sky);
  }
  .gsl-sp-awards .eyebrow {
    margin-bottom: 4px;
    font: 400 8px/1 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .gsl-sp-awards .aw.ghost .eyebrow {
    color: var(--amber);
  }
  .gsl-sp-awards .aw.decoy .eyebrow {
    color: var(--sky);
  }
  .gsl-sp-awards .who {
    font: 800 17px/1 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-awards p {
    margin: 5px 0 0;
    font: 400 10.5px/1.45 var(--font-body);
    color: var(--fg-2);
  }
  .gsl-sp-awards .ember {
    color: var(--ember);
  }
  .gsl-sp-quote {
    margin-bottom: 20px;
    padding: 12px 14px;
    border-left: 3px solid var(--sky);
    border-radius: 0 10px 10px 0;
    background: var(--ink-1);
  }
  .gsl-sp-quote .eyebrow {
    margin-bottom: 6px;
    font: 400 8px/1 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--sky);
  }
  .gsl-sp-quote .q {
    margin: 0;
    font: italic 400 14px/1.4 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-quote .cap {
    margin: 8px 0 0;
    font: 400 10px/1.5 var(--font-body);
    color: var(--fg-muted);
  }
  .gsl-sp-quote .flag {
    margin: 6px 0 0;
    font: italic 400 9px/1.4 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-sp-sub {
    margin: 0 0 8px;
    font: 400 9.5px/1 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .gsl-sp-torow {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 7px;
  }
  .gsl-sp-torow .nm {
    width: 58px;
    flex: 0 0 auto;
    font: 700 12px/1.2 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-torow .track {
    flex: 1;
    min-width: 0;
    height: 13px;
    border-radius: 4px;
    background: var(--mash-pulp-soft);
    border: 1px solid var(--mash-pulp-edge);
    overflow: hidden;
  }
  .gsl-sp-torow .fill {
    display: block;
    height: 100%;
    background: var(--mash-pulp);
  }
  .gsl-sp-torow .n {
    width: 26px;
    flex: 0 0 auto;
    text-align: right;
    font: 400 12px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--mash-pulp);
  }
  .gsl-sp-div {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 20px 0 8px;
  }
  .gsl-sp-div span {
    font: 400 9px/1 var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .gsl-sp-div i {
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .gsl-sp-svg {
    display: block;
  }
  .gsl-sp-svg .t-hub {
    font: 700 12px var(--font-body);
    fill: var(--mash-pulp);
  }
  .gsl-sp-svg .t-name {
    font: 600 12px var(--font-body);
    fill: var(--fg-2);
  }
  .gsl-sp-svg .t-count {
    font: 700 13px var(--font-mono);
    fill: var(--bone);
  }
  .gsl-sp-svg .t-node {
    font: 700 12px var(--font-body);
    fill: var(--bone);
  }
  .gsl-sp-svg .t-nodenum {
    font: 400 10px var(--font-mono);
    fill: var(--bone);
  }
  .gsl-sp-svg .t-axis {
    font: 400 10.5px var(--font-body);
    fill: var(--fg-muted);
  }
  .gsl-sp-cap {
    margin: 2px 0 18px;
    font: italic 400 11px/1.5 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-sp-cap b {
    color: var(--fg-muted);
  }
  .gsl-sp-foot {
    margin: 12px 0 0;
    padding-top: 11px;
    border-top: 1px solid var(--line);
    font: 400 11px/1.55 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-sp-foot b {
    color: var(--fg-muted);
  }

  /* ── tab 4 · targets ── */
  .gsl-sp-q {
    margin: 2px 0 6px;
    font: 700 16px/1.25 var(--font-display);
    letter-spacing: -0.01em;
    color: var(--fg);
  }
  .gsl-sp-sublede {
    margin: 0 0 14px;
    font: 400 11px/1.5 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-sp-sublede b {
    color: var(--fg-muted);
  }
  .gsl-sp-trow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  .gsl-sp-trow .nm {
    width: 66px;
    flex: 0 0 auto;
    font: 700 13px/1.2 var(--font-display);
    color: var(--fg);
  }
  .gsl-sp-trow .mid {
    flex: 1;
    min-width: 0;
  }
  .gsl-sp-trow .track {
    display: block;
    height: 9px;
    border-radius: 5px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .gsl-sp-trow .fill {
    display: block;
    height: 100%;
  }
  .gsl-sp-trow .fill.moss {
    background: var(--moss);
  }
  .gsl-sp-trow .fill.amber {
    background: var(--amber);
  }
  .gsl-sp-trow .fill.ember {
    background: var(--ember);
  }
  .gsl-sp-trow .mis {
    display: block;
    margin-top: 3px;
    font: 400 9.5px/1.3 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-sp-trow .mis b {
    color: var(--fg-muted);
  }
  .gsl-sp-trow .num {
    width: 70px;
    flex: 0 0 auto;
    text-align: right;
  }
  .gsl-sp-trow .num b {
    font: 400 13px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .gsl-sp-trow .num b.moss {
    color: var(--moss);
  }
  .gsl-sp-trow .num b.amber {
    color: var(--amber);
  }
  .gsl-sp-trow .num b.ember {
    color: var(--ember);
  }
  .gsl-sp-trow .num em {
    font: 400 9px/1 var(--font-mono);
    font-style: normal;
    color: var(--fg-quiet);
  }

  .gsl-silent {
    margin: 10px 0 0;
    font: 400 12px/1.5 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-silent b {
    color: var(--fg);
  }
  .gsl-gridnote {
    margin: 8px 0 0;
    font: 400 11px/1.55 var(--font-body);
    color: var(--fg-quiet);
  }
  .gsl-gridnote b {
    color: var(--fg);
  }
  /* Phone: two columns of cards still fit at ~400px, but the award pair and the
     plot labels are the first things to crowd. */
  @media (max-width: 340px) {
    .gsl-sp-awards {
      flex-direction: column;
    }
  }
  @media (max-width: 420px) {
    .gsl-sp-plot .dlab b {
      font-size: 11px;
    }
    .gsl-sp-tab {
      font-size: 8px;
    }
  }

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
