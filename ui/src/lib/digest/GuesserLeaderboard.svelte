<script lang="ts" module>
  // ── guesser-render · Guesser/Storylines redesign (CD handoff §4.1) ─────────
  // Visual form of the frontend-only synthetic 'guesser' section: "The
  // Guesser" — a deterministic ledger of one player's habit of guessing who
  // submitted each song from their vote comments, as one drink-deeper descent
  // down the playlist.
  //
  // Renders (top → bottom), all inside the existing DigestSection shell:
  //   1. shared "◆ back of the zine" stamp (shared identity with The Regulars)
  //   2. a static, dog-focused legend epigraph
  //   3. subhead — this round's record + season average
  //   4. season hit-rate sparkbars + a dashed season-average line (arc-first)
  //   5. the "descent" — a play-order timeline over a sober→red-zone gradient,
  //      with landmark annotations mined from his real vote comments and a
  //      declared-joke 🐾 "no-driving line" (NOT a measurement — a fixed marker)
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

  // Static legend (D2 · 2b). Credits only the ritual and the dog — never who
  // first noticed it. Always present so it survives the exported PNG.
  const LEGEND =
    'He guesses the submitter of every song, every round — one drink deeper ' +
    'down the list. Nobody assigned him this. He will not be stopped.';

  // Landmark keyword → icon map (CD §4.1). An annotation fires ONLY when the
  // phrase is present in that round's comment — keeps it honest and varying.
  const LANDMARKS: { icon: string; re: RegExp }[] = [
    { icon: '💧', re: /drink\s+.*water|some water/i },
    { icon: '🚽', re: /bathroom|go (?:use|to) the (?:bathroom|toilet)|\bpee\b/i },
    { icon: '🧠', re: /lost .*coherence|no.*coherence/i },
    { icon: '😴', re: /fell asleep|took over/i },
    { icon: '🍸', re: /another (?:glass|drink)|refill|absinthe/i },
  ];

  // The 🐾 no-driving line is a declared joke, not a measurement: the data has
  // play-ORDER, not clock-TIME. It sits at a fixed fraction down the list.
  const NO_DRIVE_FRAC = 0.56;

  type Annotation = { leftPct: number; icon: string; quote: string; pos: number; hit: boolean; place: 'up' | 'dn' };

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
  const caption = $derived((content ?? {}) as { title?: string; body?: string });

  const guesserName = $derived(g?.guesserName ?? null);
  const weekly = $derived(g?.weekly ?? { attempts: 0, correct: 0, rate: 0, guesses: [] });
  const guesses = $derived(weekly.guesses ?? []);
  const seasonHitRates = $derived(g?.seasonHitRates ?? []);
  const seasonRate = $derived(g?.seasonRate ?? 0);
  // "Eludes him" (D3): players he's guessed the most and NEVER once gotten right.
  const eludes = $derived((g?.eludesHim ?? []).filter((r) => r.rate === 0));
  const littermates = $derived(g?.littermates ?? null);

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
    if (lastHit) {
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

    <p class="gsl-epigraph">{LEGEND}</p>

    <p class="gsl-subhead">
      {guesserName.toLowerCase()} · <b>{weekly.correct}/{weekly.attempts}</b> this round · season average
      <b>{pct(seasonRate)}</b> · deterministic · no llm gloss
    </p>

    {#if caption.body}<p class="gsl-user-note">{caption.body}</p>{/if}

    <!-- ── season arc (D3 · arc-first) ── -->
    {#if seasonBars.length}
      <div class="gsl-blocklbl">the season so far · hit-rate over {seasonBars.length} rounds</div>
      <div class="gsl-spark">
        <div class="gsl-avg" style="bottom:{avgBottom}px"><span>season avg {pct(seasonRate)}</span></div>
        {#each seasonBars as b (b.label)}
          <div class="gsl-bar" class:now={b.now} style="height:{b.h}px" title={b.title}></div>
        {/each}
      </div>
      <div class="gsl-spark-x">
        {#each seasonBars as b (b.label)}<span>{b.label}</span>{/each}
      </div>
    {/if}

    <!-- ── the descent (D1 · 2a) ── -->
    {#if hasWeekly && nodes.length}
      <div class="gsl-blocklbl">this round · the descent down the playlist</div>
      <div class="gsl-dz">
        <div class="gsl-dz-lbl"><span>sober · song 1</span><span class="r">blitzed · song {playCount}</span></div>
        <div class="gsl-tl">
          {#each annotations as a (a.pos)}
            <div class="gsl-ann {a.place}" style="left:{a.leftPct}%">
              <div class="q">{a.icon ? `${a.icon} ` : ''}{a.hit ? `"${a.quote}"` : a.quote}</div>
              <div class="p">song {String(a.pos).padStart(2, '0')}{a.hit ? ' · hit' : ''}</div>
            </div>
          {/each}
          <div class="gsl-track">
            <div class="gsl-fill" style="right:{Math.round((1 - NO_DRIVE_FRAC) * 100)}%"></div>
            <div class="gsl-nodrive" style="left:{Math.round(NO_DRIVE_FRAC * 100)}%">
              <span class="lab">🐾 no-driving line</span>
            </div>
            {#each nodes as n, i (i)}
              <div class="gsl-node" class:hit={n.hit} class:miss={!n.hit} style="left:{n.left}%"></div>
            {/each}
          </div>
        </div>
        <p class="gsl-descap">
          the 🐾 no-driving line marks where a dog of his approximate build would, on average, stop being
          trusted with the family sedan.
        </p>
        <p class="gsl-caveat">
          <b>Impairment extrapolated from the mean bodyweight of comparably-sized dogs; not admissible in
          any court, doghouse tribunal, or Music League vote dispute.</b> Past this point Doggie walks — or
          asks Mrs. Doggie to drive.
        </p>
      </div>
    {/if}

    <!-- ── eludes + littermates (D3) ── -->
    <div class="gsl-minirow">
      <div class="gsl-mini">
        <h5>eludes him</h5>
        <p class="gsl-miniexp">players he's guessed the most times and <b>never once</b> gotten right — all season.</p>
        {#if eludes.length}
          {#each eludes.slice(0, 3) as row (row.playerId)}
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
    color: var(--mash-pulp-edge);
    font: 700 8.5px/1 var(--font-mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    transform: rotate(-1.5deg);
  }
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
    border-top: 1px dashed var(--mash-pulp-edge);
    z-index: 1;
  }
  .gsl-avg span {
    position: absolute;
    right: 0;
    top: -13px;
    color: var(--mash-pulp-edge);
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

  /* descent timeline on a sober→red-zone gradient */
  .gsl-dz {
    position: relative;
    padding: 30px 22px 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background:
      linear-gradient(90deg,
        rgba(62, 194, 122, 0.10) 0%,
        rgba(255, 91, 46, 0.06) 45%,
        rgba(230, 86, 108, 0.22) 100%),
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

  @media (max-width: 460px) {
    .gsl-minirow { grid-template-columns: 1fr; }
    .gsl-ann { width: 130px; }
  }
</style>
