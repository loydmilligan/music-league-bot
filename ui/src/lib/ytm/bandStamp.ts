/**
 * The band stamp — the MLB playlist page's easter egg.
 *
 * Four players own one member of a band each. Each spends a single stamp on the
 * first video they thumb up, so a video wears whichever of the four landed on it
 * first: one instrument alone means they agreed on nothing, all four on one
 * video means they all picked the same thing. It encodes nothing the `▲ n`
 * count does not already say (design/mlb-playlist-spec.md, "The band stamp"),
 * which is why the output is aria-hidden and decorative.
 *
 * The marks are inline SVG paths roughened with the same feTurbulence
 * displacement the share flyer uses (videoCover.ts, filter `xr2`), so the stamp
 * reads as the same printed object as the art it sits under — rough edges,
 * imperfect ink, a plate that is very slightly out of true.
 *
 * Deterministic and self-contained: the page is one static file served by a
 * dumb Caddy, so no randomness (the same round must render byte-identically
 * twice) and no external assets.
 */

export type BandMember = 'matt' | 'jon' | 'brian' | 'tj';

/**
 * `colour` is the mark's INK, not a text colour. Brian's is black on purpose —
 * see PATCH: his mark is the one drawn on a paper patch, because #12151a on the
 * page's --ink-0 (#07090c) is invisible. Anything that wants to print a player's
 * name needs its own colour.
 */
export const BAND: Record<BandMember, { player: string; colour: string; instrument: string }> = {
  matt: { player: 'Matt Mariani', colour: '#4d86c9', instrument: 'guitar' },
  jon: { player: 'Jon Black', colour: '#d14a3c', instrument: 'mic' },
  brian: { player: 'Brian Pascoe', colour: '#12151a', instrument: 'bass' },
  tj: { player: 'TJ Cook', colour: '#57a35f', instrument: 'drums' },
};

/**
 * Reading order of the four, used wherever a set of members has to come out in
 * a stable order. Not the drawing order — see STAGE.
 */
const MEMBERS: BandMember[] = ['matt', 'jon', 'brian', 'tj'];

/**
 * Drawing order: backline first, front line last, so the overlaps fall the way
 * they do on a stage (the singer in front of the kit, not behind it). Drawing in
 * caller order instead makes the same four marks stack differently per video,
 * which is exactly the "pile" the design warns about.
 */
const STAGE: BandMember[] = ['tj', 'brian', 'matt', 'jon'];

/** Each mark is authored in its own MARK-unit box and placed by its slot. */
const MARK = 40;
const FRAME = 100;
/** Usable width once the roughening filter's displacement has room to wobble. */
const FIT = 92;
/**
 * A lone mark would otherwise blow up to fill the whole frame and read as a
 * different (bigger) object than the same mark in a full band. Capping the
 * scale keeps one instrument recognisably one member of the same band.
 */
const MAX_SCALE = 1.9;

/** Where each player stands, plus the tilt that keeps the mark hand-stamped. */
const SLOT: Record<BandMember, { x: number; y: number; tilt: number }> = {
  tj: { x: 30, y: 3, tilt: -2 },
  brian: { x: 55, y: 30, tilt: 4 },
  matt: { x: 5, y: 30, tilt: -5 },
  jon: { x: 30, y: 55, tilt: 3 },
};

const round = (n: number): number => Math.round(n * 100) / 100;

/** Canonical order, de-duplicated, unknown values dropped. */
function normalise(members: BandMember[]): BandMember[] {
  const seen = new Set(members);
  return MEMBERS.filter((m) => seen.has(m));
}

/**
 * Place the occupied slots in the middle of the frame at the largest scale they
 * fit at. Without the re-centring a solo guitar sits in the bottom-left corner
 * of an otherwise empty box — which at 44px looks like a rendering bug rather
 * than a deliberate lone musician.
 */
function fit(present: BandMember[]): { scale: number; dx: number; dy: number } {
  const x0 = Math.min(...present.map((m) => SLOT[m].x));
  const x1 = Math.max(...present.map((m) => SLOT[m].x)) + MARK;
  const y0 = Math.min(...present.map((m) => SLOT[m].y));
  const y1 = Math.max(...present.map((m) => SLOT[m].y)) + MARK;
  const scale = Math.min(FIT / (x1 - x0), FIT / (y1 - y0), MAX_SCALE);
  return {
    scale: round(scale),
    dx: round(FRAME / 2 - (scale * (x0 + x1)) / 2),
    dy: round(FRAME / 2 - (scale * (y0 + y1)) / 2),
  };
}

/** A stamp pressed by hand is never square to the page. Fixed per member set. */
function jitter(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
  return round((h % 61) / 10 - 3);
}

/**
 * The instrument marks, each authored in a 40x40 box. Two ink weights only: a
 * heavy outline that survives the displacement filter at 44px, and one lighter
 * detail pass that gives the mark its instrument at larger sizes and blurs into
 * texture at small ones.
 */
const MARKS: Record<BandMember, string> = {
  matt:
    '<path d="M12.4 34.6c-5.2 0-8.8-3.4-8.8-8.1 0-4.4 3.2-7.6 7.4-7.6 1.9 0 3 .6 4.6.6 1.7 0 2.8-.9 4.6-.6 3.6.6 6 3.4 6 7.2 0 5.1-3.8 8.5-9 8.5z"/>' +
    '<path d="M18.6 19.4 31.4 6.7"/><path d="m30.3 5.7 3.7-3.5 3 3.2-3.7 3.5z"/>' +
    '<g stroke-width="1.1"><path d="M16.6 21.6 29.4 8.9"/><path d="M11.2 24.8h6.2"/><path d="M9.6 30.4h7.4"/></g>',
  jon:
    '<path d="M20 3.6c4.7 0 8.2 3.7 8.2 8.4s-3.5 8.4-8.2 8.4-8.2-3.7-8.2-8.4S15.3 3.6 20 3.6z"/>' +
    '<path d="M16.8 19.8 13.4 34.4h13.2L23.2 19.8"/>' +
    '<g stroke-width="1.1"><path d="M12.6 9.4h14.8"/><path d="M12.6 14.6h14.8"/><path d="M19.6 34.4c-4.4 1.4-1 4.4 2.6 3"/></g>',
  brian:
    '<path d="M27.6 35c5.2 0 8.8-3.4 8.8-8.1 0-4.4-3.2-7.6-7.4-7.6-1.9 0-3 .6-4.6.6-1.7 0-2.8-.9-4.6-.6-3.6.6-6 3.4-6 7.2 0 5.1 3.8 8.5 9 8.5z"/>' +
    '<path d="M21.4 19.8 8.2 6.4"/><path d="m9.3 5.2-4.6-4.4-3.4 4 4.6 4.4z"/>' +
    '<g stroke-width="1.1"><path d="M23.4 22 10.4 8.6"/><path d="M22.6 25.2h6.4"/></g>',
  tj:
    '<path d="M20 21.6c7.2 0 13 3.4 13 7.8s-5.8 7.8-13 7.8-13-3.4-13-7.8 5.8-7.8 13-7.8z"/>' +
    '<path d="M21.4 8.8 33.2 11.4 21.4 14 9.6 11.4z"/>' +
    '<g stroke-width="1.1"><path d="M21.4 14v7.8"/><path d="M20 25.8a3.6 3.6 0 1 0 .1 0z"/>' +
    '<path d="M8.6 33.6 5.4 37.4"/><path d="M31.4 33.6 34.6 37.4"/></g>',
};

/**
 * The paper patch under Brian's bass. His ink is black on a #07090c page, which
 * is the one solo state guaranteed to look like a bug; a torn scrap of the same
 * bone stock as the share flyer's sheet gives the black something to be black
 * against, and reads as part of the printed-object language rather than as a
 * special case for one player.
 *
 * Scaled out past the mark box on purpose: the bass headstock reaches the corner
 * of its box and the roughening filter pushes it further, so a patch that only
 * covered the box left the black headstock hanging off the scrap onto the dark
 * card — invisible, which is the whole failure this exists to prevent.
 */
const PATCH =
  `<path d="M-1 2 5 -.6 11 2 17 -1 23 2 29 -.8 35 2 41 -.4 40.6 7 41 14 40 21 41 28 40.4 35 41 41.6 ` +
  `34 40 28 41.4 22 40.2 16 41.4 10 40 4 41.4 -1 40.6 -.6 34 .4 27 -1 20 0 13 -.6 6z" ` +
  `fill="#e7e2d4" fill-opacity=".92" stroke="none" transform="translate(-2 -2) scale(1.1)"/>`;

/**
 * Inline SVG for the stamp formed by these members. Empty string for none.
 *
 * Decorative: aria-hidden, no title, and never the only carrier of anything —
 * the vote count next to it is the real data.
 */
export function bandStampSvg(members: BandMember[], opts: { size?: number } = {}): string {
  const present = normalise(members);
  if (!present.length) return '';
  const size = opts.size ?? 44;
  const key = present.join('-');
  const { scale, dx, dy } = fit(present);

  // Id is derived from the member set rather than minted, because the page is a
  // generated static file: a random id would make two builds of the same round
  // differ. Two videos with the same set therefore emit the same id, and the
  // first definition wins for both — harmless, since the filters are identical.
  const filterId = `bs-${key}`;

  // Brian's paper scrap is emitted as its own layer BENEATH every mark, not
  // inside his group. Drawn in STAGE order it landed after TJ's, and an opaque
  // scrap over an earlier mark clipped the kick drum mid-ellipse — the
  // half-erased look the whole design is trying to avoid, in the two states
  // (brian+tj, and the full band) most likely to be seen.
  const backing = present.includes('brian')
    ? `<g transform="translate(${SLOT.brian.x} ${SLOT.brian.y}) rotate(${SLOT.brian.tilt} ${MARK / 2} ${MARK / 2})">${PATCH}</g>`
    : '';

  const marks = STAGE.filter((m) => present.includes(m))
    .map((m) => {
      const s = SLOT[m];
      return (
        `<g data-band-member="${m}" transform="translate(${s.x} ${s.y}) rotate(${s.tilt} ${MARK / 2} ${MARK / 2})">` +
        `<g stroke="${BAND[m].colour}" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${MARKS[m]}</g></g>`
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME} ${FRAME}" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false" style="display:block;overflow:visible">` +
    `<filter id="${filterId}" x="-15%" y="-15%" width="130%" height="130%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed="6" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<g transform="rotate(${jitter(key)} 50 50)" opacity=".92">` +
    `<g transform="translate(${dx} ${dy}) scale(${scale})" filter="url(#${filterId})">${backing}${marks}</g></g></svg>`
  );
}

/**
 * Which of the four spent their one stamp on this video.
 *
 * The caller owns "first upvote" — this only reads the record — so a player who
 * moved or withdrew their pick is handled wherever that record is maintained,
 * not here.
 */
export function stampersFor(
  videoId: string,
  firstUpvoteByMember: Record<BandMember, string | null>,
): BandMember[] {
  return MEMBERS.filter((m) => firstUpvoteByMember?.[m] === videoId);
}
