// ── The style shelf · Guesser/Storylines redesign (CD handoff §6) ────────────
//
// ONE `style:` value per cast entry picks its layout. This module is the seam:
// `StorylinesCast.svelte` learns three things — `normalizeCast()`,
// `resolveStyle()`, and the `REGULAR_STYLES` registry — and gets seven layouts
// behind them. Delete this module and seven layouts' worth of `{#if style ===}`
// reappears inline in the carrier; it earns its keep.
//
// The entries are HAND-AUTHORED as YAML in the digest review screen (see
// yamlContent.ts) until the tic miner lands (BACKLOG 0a). Everything here must
// therefore be defensive: a human typo must degrade to `quote-led`, never crash
// the digest page. A hydration crash takes the whole export down — see the
// each_key_duplicate history on this section.

/** The shelf. `quote-led` is the fallback and must always render something. */
export const REGULAR_STYLE_NAMES = [
  'quote-led',
  'spotlight',
  'call-response',
  'edit-history',
  'roster-map',
  'refrain',
  'buzzer',
] as const;

export type RegularStyle = (typeof REGULAR_STYLE_NAMES)[number];

/** Taxonomy type → style (CD handoff §6). Keys are lowercased/trimmed. */
export const TYPE_TO_STYLE: Record<string, RegularStyle> = {
  'one-word oracle': 'spotlight',
  'ritual opener': 'refrain',
  'sloppy-fast typist': 'edit-history',
  'self-corrector': 'edit-history',
  'chronic misspeller': 'roster-map',
  'nickname-minter': 'roster-map',
  'phonetic speller': 'roster-map',
  'catchphrase-holder': 'refrain',
  'laugh-signature': 'refrain',
  'retirement threatener': 'refrain',
  'deadline brinkman': 'buzzer',
  ghost: 'buzzer',
  'penalty taker': 'buzzer',
};

// ── Per-style payloads ───────────────────────────────────────────────────────

/** `spotlight` — one utterance at display size; the message IS the tell. */
export type Spotlight = { text: string; caption: string };

/** `call-response` — small prompt → big one-word reply. */
export type Exchange = { prompt: string; reply: string };

/** `edit-history` — two stat lines + one redlined double-edit. */
export type Stat = { value: string; label: string };
export type Repair = { was: string; now: string };
export type EditExample = { repairs: Repair[]; text: string; caption: string };

/** `roster-map` — real → alias two-column map. */
export type Pair = { real: string; alias: string };

/** `refrain` — signature token big + dated tally. */
export type Refrain = { token: string; caption: string; occurrences: string[]; count: string };

/** `buzzer` — timestamp track, marks clustered at the deadline. */
export type Buzzer = { opens: string; deadline: string; marks: string[]; caption: string };

/**
 * One regular. Every style-specific field is optional: an entry that declares
 * `style: refrain` but carries no `refrain` payload falls back to `quote-led`
 * rather than rendering an empty card.
 */
export type RegularEntry = {
  name: string;
  motif: string;
  /** taxonomy type, used to pick a style when `style:` is absent */
  type: string;
  style: RegularStyle;
  /**
   * Optional one-liner. The old mandatory 3-line `headline` is gone from the
   * design, but every storylines row written before this redesign carries
   * `headline` and no `note` — so `normalizeCast` falls back to it rather than
   * silently dropping the paragraph out of an already-approved draft.
   */
  note: string;
  /** verbatim quotes; the `quote-led` hero and every style's supporting evidence */
  evidence: string[];
  /** tokens marked amber inside the evidence — the tell itself, made visible */
  highlight: string[];
  spotlight: Spotlight | null;
  exchanges: Exchange[];
  stats: Stat[];
  example: EditExample | null;
  summary: string;
  pairs: Pair[];
  refrain: Refrain | null;
  buzzer: Buzzer | null;
};

// ── Coercion helpers ─────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const strList = (v: unknown): string[] => arr(v).map(str).filter(Boolean);

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Strip a single balanced wrapping quote pair so the component's own quote
 * marks don't double up. Hand-authored YAML arrives both ways.
 */
export function unquote(s: string): string {
  const t = s.trim();
  if (t.length < 2) return t;
  // Only strip a MATCHING pair. A single character class on both ends would
  // also eat mismatched quotes, turning `"foo'` into `foo`.
  const closer: Record<string, string> = { '"': '"', "'": "'", '“': '”' };
  const open = t[0];
  if (closer[open] && t[t.length - 1] === closer[open]) return t.slice(1, -1).trim();
  return t;
}

/**
 * Does this entry actually carry the payload its declared style needs? A style
 * with nothing to show is worse than the fallback.
 */
export function stylePayloadPresent(e: RegularEntry, style: RegularStyle): boolean {
  switch (style) {
    case 'spotlight':
      return !!e.spotlight;
    case 'call-response':
      return e.exchanges.length > 0;
    case 'edit-history':
      return !!e.example || e.stats.length > 0;
    case 'roster-map':
      return e.pairs.length > 0;
    case 'refrain':
      return !!e.refrain;
    case 'buzzer':
      return !!e.buzzer;
    case 'quote-led':
      return true;
  }
}

/**
 * Pick the layout for an entry: an explicit valid `style:` wins, else the
 * taxonomy `type:` maps to one, else `quote-led`. A style whose payload is
 * missing degrades to `quote-led` so a half-written YAML block still renders.
 */
export function resolveStyle(e: RegularEntry): RegularStyle {
  const declared = e.style as string;
  // trim as well as lowercase: normalizeCast already trims, but resolveStyle is
  // exported and must not depend on its caller having done that.
  const fromType = TYPE_TO_STYLE[e.type.trim().toLowerCase()];
  const candidate = (REGULAR_STYLE_NAMES as readonly string[]).includes(declared)
    ? (declared as RegularStyle)
    : (fromType ?? 'quote-led');
  return stylePayloadPresent(e, candidate) ? candidate : 'quote-led';
}

/**
 * Coerce whatever the YAML/LLM produced into a clean `RegularEntry[]`.
 *
 * The LLM's generic missing-kind fallback is `{ title, body, items }` — NOT
 * `{ title, cast }` — so `content.cast` may be absent or malformed. Always
 * returns an array; the carrier renders its n=0 state when it's empty.
 */
export function normalizeCast(content: unknown): RegularEntry[] {
  const cast = arr(obj(content).cast);
  return cast
    .map((raw): RegularEntry => {
      const m = obj(raw);
      const ex = obj(m.example);
      const rf = obj(m.refrain);
      const bz = obj(m.buzzer);
      const sp = obj(m.spotlight);

      const repairs = arr(ex.repairs)
        .map((r) => ({ was: str(obj(r).was), now: str(obj(r).now) }))
        .filter((r) => r.was && r.now);

      const pairs = arr(m.pairs)
        .map((p) => ({ real: str(obj(p).real), alias: str(obj(p).alias) }))
        .filter((p) => p.real && p.alias);

      const exchanges = arr(m.exchanges)
        .map((x) => ({ prompt: str(obj(x).prompt), reply: str(obj(x).reply) }))
        .filter((x) => x.reply);

      const stats = arr(m.stats)
        .map((s) => ({ value: str(obj(s).value), label: str(obj(s).label) }))
        .filter((s) => s.value && s.label);

      const exText = str(ex.text);
      const token = str(rf.token);
      const marks = strList(bz.marks);

      return {
        name: str(m.name),
        motif: str(m.motif),
        type: str(m.type),
        style: str(m.style) as RegularStyle,
        // `headline` fallback keeps pre-redesign rows rendering their paragraph.
        note: str(m.note) || str(m.headline),
        evidence: strList(m.evidence).map(unquote),
        highlight: strList(m.highlight),
        spotlight: str(sp.text) ? { text: str(sp.text), caption: str(sp.caption) } : null,
        exchanges,
        stats,
        example: exText || repairs.length ? { repairs, text: exText, caption: str(ex.caption) } : null,
        summary: str(m.summary),
        pairs,
        refrain: token
          ? { token, caption: str(rf.caption), occurrences: strList(rf.occurrences), count: str(rf.count) }
          : null,
        buzzer: marks.length
          ? { opens: str(bz.opens), deadline: str(bz.deadline), marks, caption: str(bz.caption) }
          : null,
      };
    })
    .filter((e) => !!e.name);
}

/**
 * Split a quote into plain/marked runs so the tell can be emphasised without
 * trusting hand- or LLM-authored HTML into the DOM. Whole-word, case-insensitive.
 *
 * Moved here from StorylinesCast.svelte — every style needs it now, not just
 * the quote list.
 */
export function markRuns(text: string, tokens: string[]): { t: string; hit: boolean }[] {
  const words = tokens.map((w) => w.trim()).filter(Boolean);
  if (!words.length) return [{ t: text, hit: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(${escaped})\\b`, 'gi');
  const out: { t: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i), hit: false });
    out.push({ t: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false });
  return out.length ? out : [{ t: text, hit: false }];
}

/**
 * `edit-history` example text marks its repaired tokens with ⟨angle brackets⟩
 * in the YAML. Split into runs so the wrong token can be struck through in
 * --ember and the fix shown in --moss, without injecting HTML.
 */
export function splitRepairRuns(
  text: string,
  repairs: Repair[],
): { t: string; repair: Repair | null }[] {
  const out: { t: string; repair: Repair | null }[] = [];
  const re = /⟨([^⟩]*)⟩/g;
  let last = 0;
  let matched = false;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    matched = true;
    if (i > last) out.push({ t: text.slice(last, i), repair: null });
    // Keep any padding the author left inside the brackets as PLAIN text —
    // striking through `⟨ dont ⟩` must not swallow the spaces around the word,
    // or "I ⟨ dont ⟩ know" renders as "I dont know".
    const raw = m[1];
    const was = raw.trim();
    const lead = raw.slice(0, raw.indexOf(was) < 0 ? 0 : raw.indexOf(was));
    const tail = raw.slice(lead.length + was.length);
    if (lead) out.push({ t: lead, repair: null });
    if (was)
      out.push({ t: was, repair: repairs.find((r) => r.was.toLowerCase() === was.toLowerCase()) ?? null });
    if (tail) out.push({ t: tail, repair: null });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), repair: null });
  // The raw-text fallback is for "no markers at all". If a marker DID match but
  // produced nothing (a bare `⟨⟩`), fall back to empty — never to the raw text,
  // or the authoring brackets leak into the rendered digest.
  if (out.length) return out;
  return [{ t: matched ? '' : text, repair: null }];
}
