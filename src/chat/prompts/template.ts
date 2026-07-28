/**
 * Tiny {{dotted.path}} interpolation for bot replies.
 *
 * Kept deliberately dumb — no logic, no loops, no partials. A reply template is
 * copy with holes in it; anything cleverer belongs in the caller that builds the
 * variables. Unknown placeholders render empty rather than throwing, because a
 * missing variable must never cost the group its reply, but they are reported so
 * tests can assert a template is fully satisfied.
 */

export interface RenderResult {
  text: string;
  /** Placeholders that resolved to nothing — a template authoring bug. */
  missing: string[];
}

export type TemplateVars = Record<string, unknown>;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export function render(template: string, vars: TemplateVars): RenderResult {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER, (_all, path: string) => {
    const value = lookup(vars, path);
    if (value === undefined || value === null || value === '') {
      missing.push(path);
      return '';
    }
    return String(value);
  });
  // Collapse whitespace an emptied placeholder may have left mid-sentence,
  // without touching deliberate newlines.
  return { text: text.replace(/[^\S\n]{2,}/g, ' ').replace(/[^\S\n]+\n/g, '\n').trim(), missing };
}

function lookup(vars: TemplateVars, path: string): unknown {
  let cur: unknown = vars;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Pick one variant. Deterministic in `seed` so the same answer always yields the
 * same reply — a bot that says something different on a retry looks broken, and
 * tests can pin the output.
 */
export function pickVariant(variants: string[], seed: string): string | null {
  if (variants.length === 0) return null;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return variants[Math.abs(h) % variants.length];
}
