// YAML <-> section content. YAML is an EDITING MODE, not a storage format:
// the DB still holds JSON in content_json. This module is the whole seam —
// serialise a content object for the textarea, parse it back, and say which
// section kinds should open in YAML mode by default.
import { isMap, LineCounter, parseDocument, stringify, visit, type Document } from 'yaml';

/** Section kinds whose shapes are too nested for the generic form editor. */
export const YAML_FIRST_KINDS: Set<string> = new Set(['storylines', 'stats']);

/**
 * Serialise content as YAML. Key order follows the object's own order (the
 * `yaml` package does not sort), anchors/aliases are off so repeated objects
 * print in full, and lines wrap wide enough that prose fields stay on one line.
 */
export function toYaml(content: unknown): string {
  const value = content ?? {};
  return stringify(value, {
    aliasDuplicateObjects: false,
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
  });
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse YAML back to a plain JS object. Never throws — errors come back as strings. */
export function fromYaml(src: string): ParseResult {
  const lineCounter = new LineCounter();
  let doc: Document.Parsed;
  try {
    doc = parseDocument(src, { prettyErrors: true, lineCounter });
  } catch (err) {
    return { ok: false, error: describeThrown(err) };
  }

  if (doc.errors.length > 0) return { ok: false, error: describeError(doc.errors[0]) };

  const hazard = findFlowHazard(doc, src, lineCounter);
  if (hazard) return { ok: false, error: hazard };

  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 100 });
  } catch (err) {
    return { ok: false, error: describeThrown(err) };
  }

  if (!isMapping(value)) {
    return { ok: false, error: `Top level must be a mapping (key: value), got ${describeType(value)}` };
  }
  return { ok: true, value };
}

// Two authoring hazards, not YAML bugs: both are legal YAML that silently
// produces a shape the author didn't mean, which in a digest means content
// quietly going missing. We refuse them and name the fix.
//
//  1. Inside a flow mapping `{…}` an unquoted comma ends the entry, so
//     `{at: Jensen, over an Outside Lands gif}` becomes a second, value-less key.
//  2. Inside a flow sequence `[…]` a brace-less `key: value` becomes a one-entry
//     map, so `marks: [23: 25]` becomes `[{23: 25}]` instead of a list.
//     (`[23:25]`, no space, is already a plain string — that one is fine.)
function findFlowHazard(doc: Document.Parsed, src: string, lineCounter: LineCounter): string | null {
  let found: string | null = null;
  visit(doc, {
    Map(_, node) {
      if (found || !node.flow) return;
      const start = node.range?.[0];
      if (start === undefined || src[start] === '{') return;
      found = `${at(start, lineCounter)}"${src.slice(start, node.range?.[1]).trim()}" is being read as a key and a value inside [ ] — quote it, or wrap it in { } if you meant a mapping`;
    },
    Pair(_, pair, path) {
      if (found || pair.value !== null) return;
      const parent = path[path.length - 1];
      if (!isMap(parent) || !parent.flow) return;
      const key = pair.key as { toString(): string; range?: [number, number, number] };
      found = `${at(key.range?.[0], lineCounter)}"${key}" has no value — inside { } a comma ends the entry, so quote the whole value or use block style`;
    },
  });
  return found;
}

function at(offset: number | undefined, lineCounter: LineCounter): string {
  if (offset === undefined) return '';
  const { line, col } = lineCounter.linePos(offset);
  return `Line ${line}, column ${col}: `;
}

// Section content is a plain `{key: value}` object and nothing else. A tag can
// hand back an exotic that is still `typeof 'object'` — `!!binary` yields a
// Uint8Array, `!!set` a Set — so check the prototype, not just the typeof.
function isMapping(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype;
}

function describeType(value: unknown): string {
  if (value === null || value === undefined) return 'an empty document';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'object') return `a ${Object.getPrototypeOf(value)?.constructor?.name ?? 'exotic'} value`;
  return `a ${typeof value}`;
}

/** `yaml` error objects carry a `linePos` when prettyErrors is on. */
function describeError(err: { message: string; linePos?: [{ line: number; col: number }, ...unknown[]] }): string {
  const at = err.linePos?.[0];
  const message = stripPosition(err.message);
  return at ? `Line ${at.line}, column ${at.col}: ${message}` : message;
}

function describeThrown(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; linePos?: [{ line: number; col: number }, ...unknown[]] };
    return describeError(e);
  }
  return String(err);
}

// prettyErrors already appends "at line N, column M" plus a source excerpt to
// the message; we render the position ourselves, so drop the tail.
function stripPosition(message: string): string {
  return message.split('\n')[0].replace(/\s+at line \d+, column \d+:?$/, '').trim();
}
