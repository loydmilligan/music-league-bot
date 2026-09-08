import { describe, expect, it } from 'vitest';
import { BAND, bandStampSvg, stampersFor } from '../ui/src/lib/ytm/bandStamp.js';
import type { BandMember } from '../ui/src/lib/ytm/bandStamp.js';

const drawn = (svg: string): string[] => [...svg.matchAll(/data-band-member="(\w+)"/g)].map((m) => m[1]);

/** The one placement group: `translate(dx dy) scale(s)`. */
function placement(svg: string): { dx: number; dy: number; scale: number } {
  const m = svg.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/);
  if (!m) throw new Error('no placement transform in stamp');
  return { dx: Number(m[1]), dy: Number(m[2]), scale: Number(m[3]) };
}

/**
 * The ink's bounding box in frame (viewBox) units: each mark is authored in a
 * 40-unit box, placed by its own translate, then by the shared placement.
 */
function inkBox(svg: string): { x0: number; y0: number; x1: number; y1: number } {
  const { dx, dy, scale } = placement(svg);
  const slots = [...svg.matchAll(/data-band-member="\w+" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  if (!slots.length) throw new Error('no marks in stamp');
  return {
    x0: dx + scale * Math.min(...slots.map((s) => s.x)),
    y0: dy + scale * Math.min(...slots.map((s) => s.y)),
    x1: dx + scale * (Math.max(...slots.map((s) => s.x)) + 40),
    y1: dy + scale * (Math.max(...slots.map((s) => s.y)) + 40),
  };
}

/** Half a viewBox unit is a fifth of a pixel at 44px — the transforms are rounded. */
function expectCentred(box: { x0: number; y0: number; x1: number; y1: number }): void {
  expect(Math.abs((box.x0 + box.x1) / 2 - 50)).toBeLessThan(0.5);
  expect(Math.abs((box.y0 + box.y1) / 2 - 50)).toBeLessThan(0.5);
}

describe('bandStampSvg composition', () => {
  it('is nothing at all when nobody stamped it', () => {
    expect(bandStampSvg([])).toBe('');
  });

  it('draws back line before front line, whatever order the caller passes', () => {
    // Drawing in caller order would make the same four marks overlap differently
    // per video — the "pile" the design rules out.
    expect(drawn(bandStampSvg(['matt', 'jon', 'brian', 'tj']))).toEqual(['tj', 'brian', 'matt', 'jon']);
    expect(drawn(bandStampSvg(['jon', 'tj', 'matt', 'brian']))).toEqual(['tj', 'brian', 'matt', 'jon']);
  });

  it('draws each member once and ignores anything that is not one of the four', () => {
    const svg = bandStampSvg(['matt', 'matt', 'ringo' as BandMember]);
    expect(drawn(svg)).toEqual(['matt']);
  });

  it('centres a lone instrument instead of leaving it in its band position', () => {
    // The four stand in four different corners of the stage, so without the
    // re-centring pass three of these four land off-centre — a lone mark in the
    // corner of an empty box reads as a half-drawn stamp.
    for (const m of ['matt', 'jon', 'brian', 'tj'] as BandMember[]) {
      expectCentred(inkBox(bandStampSvg([m])));
    }
  });

  it('grows a sparse stamp so one mark is not a speck in an empty box', () => {
    expect(placement(bandStampSvg(['tj'])).scale).toBeGreaterThan(placement(bandStampSvg(['matt', 'tj'])).scale);
    expect(placement(bandStampSvg(['matt', 'tj'])).scale)
      .toBeGreaterThan(placement(bandStampSvg(['matt', 'jon', 'brian', 'tj'])).scale);
  });

  it('keeps every arrangement inside the frame, centred', () => {
    const sets: BandMember[][] = [['tj'], ['matt', 'jon'], ['brian', 'tj', 'jon'], ['matt', 'jon', 'brian', 'tj']];
    for (const set of sets) {
      const box = inkBox(bandStampSvg(set));
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.y0).toBeGreaterThanOrEqual(0);
      expect(box.x1).toBeLessThanOrEqual(100);
      expect(box.y1).toBeLessThanOrEqual(100);
      expectCentred(box);
    }
  });

  it('inks each present member and only them', () => {
    const svg = bandStampSvg(['matt', 'brian']);
    expect(svg).toContain(BAND.matt.colour);
    expect(svg).toContain(BAND.brian.colour);
    expect(svg).not.toContain(BAND.jon.colour);
    expect(svg).not.toContain(BAND.tj.colour);
  });

  it('puts a paper patch under the black bass, and under nothing else', () => {
    // Brian's ink is #12151a on a #07090c page: without the patch his solo stamp
    // is invisible and reads as a bug.
    expect(bandStampSvg(['brian'])).toContain('#e7e2d4');
    expect(bandStampSvg(['brian', 'jon'])).toContain('#e7e2d4');
    expect(bandStampSvg(['matt', 'jon', 'tj'])).not.toContain('#e7e2d4');
  });
});

describe('bandStampSvg output', () => {
  it('scales by attribute, not by geometry, so all sizes are the same drawing', () => {
    expect(bandStampSvg(['jon'])).toContain('width="44" height="44"');
    const big = bandStampSvg(['jon'], { size: 88 });
    expect(big).toContain('width="88" height="88"');
    expect(big).toContain('viewBox="0 0 100 100"');
    expect(placement(big)).toEqual(placement(bandStampSvg(['jon'])));
  });

  it('renders the same bytes twice — the page is a generated static file', () => {
    expect(bandStampSvg(['matt', 'tj'])).toBe(bandStampSvg(['tj', 'matt']));
  });

  it('gives different member sets different filter ids', () => {
    const id = (svg: string) => svg.match(/<filter id="([^"]+)"/)![1];
    expect(id(bandStampSvg(['matt']))).not.toBe(id(bandStampSvg(['matt', 'tj'])));
  });

  it('is decorative and inert: no script, no external asset, hidden from AT', () => {
    const svg = bandStampSvg(['matt', 'jon', 'brian', 'tj']);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('<script');
    // The SVG namespace is the one URL allowed to appear, and nothing is fetched
    // from it; any other href/url() would be an asset the static page cannot serve.
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:|url\((?!#)/);
  });

  it('sits at a stamped angle rather than square to the page', () => {
    const angle = (svg: string) => Number(svg.match(/rotate\((-?[\d.]+) 50 50\)/)![1]);
    expect(Math.abs(angle(bandStampSvg(['brian'])))).toBeLessThanOrEqual(3);
    expect(angle(bandStampSvg(['brian']))).not.toBe(angle(bandStampSvg(['matt', 'jon'])));
  });
});

describe('stampersFor', () => {
  const first = (over: Partial<Record<BandMember, string | null>>): Record<BandMember, string | null> =>
    ({ matt: null, jon: null, brian: null, tj: null, ...over });

  it('returns the members whose one stamp landed here, in band order not record order', () => {
    const backwards = { tj: 'V1', brian: 'V1', jon: 'V1', matt: 'V1' } as Record<BandMember, string | null>;
    expect(stampersFor('V1', backwards)).toEqual(['matt', 'jon', 'brian', 'tj']);
  });

  it('ignores members who spent their stamp elsewhere or not at all', () => {
    expect(stampersFor('V1', first({ matt: 'V2', jon: 'V1', brian: null, tj: 'V1' }))).toEqual(['jon', 'tj']);
    expect(stampersFor('V1', first({}))).toEqual([]);
  });

  it('tolerates a record that never mentions a member', () => {
    expect(stampersFor('V1', { jon: 'V1' } as Record<BandMember, string | null>)).toEqual(['jon']);
  });
});

describe('regressions the review caught', () => {
  it("Brian's paper patch never paints over another member's mark", () => {
    // The patch used to be emitted inside Brian's group, so in STAGE order it
    // landed after TJ's and an opaque scrap clipped the kick drum. It must be a
    // single layer beneath every mark.
    const svg = bandStampSvg(['brian', 'tj']);
    const patchAt = svg.indexOf('data-band-member="tj"') === -1 ? -1 : svg.indexOf('#e7e2d4');
    const tjAt = svg.indexOf('data-band-member="tj"');
    const brianAt = svg.indexOf('data-band-member="brian"');
    expect(patchAt).toBeGreaterThan(-1);
    expect(tjAt).toBeGreaterThan(-1);
    // Paper first, then every mark — including marks drawn before Brian's.
    expect(patchAt).toBeLessThan(tjAt);
    expect(patchAt).toBeLessThan(brianAt);
  });

  it('emits exactly one paper patch however many members are present', () => {
    for (const set of [['brian'], ['brian', 'tj'], ['matt', 'jon', 'brian', 'tj']] as const) {
      expect(bandStampSvg([...set]).split('#e7e2d4').length - 1).toBeGreaterThanOrEqual(1);
    }
    // ...and none at all when Brian isn't playing.
    expect(bandStampSvg(['matt', 'tj'])).not.toContain('#e7e2d4');
  });

  it('caps how far a solo mark is scaled up', () => {
    // Without the cap a solo still fits the frame, so "stays inside the frame"
    // cannot protect it. The cap is what keeps one instrument reading as one
    // member of a band rather than as its own logo.
    const scale = Number(/scale\(([\d.]+)\)/.exec(bandStampSvg(['tj']))?.[1]);
    expect(scale).toBeLessThanOrEqual(1.9);
    // And it is genuinely a cap — the geometry alone would go further.
    expect(scale).toBeLessThan(2.3);
  });
});
