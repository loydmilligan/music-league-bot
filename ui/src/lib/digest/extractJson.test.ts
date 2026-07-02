import { describe, it, expect } from 'vitest';
import { extractJsonContent } from './llm.js';

/**
 * The LLM (via OpenRouter, jsonMode) is *supposed* to return a bare JSON object,
 * but models intermittently wrap it in a ```json fence and/or add surrounding
 * prose. The old anchored regex only stripped a fence that was the ENTIRE
 * message, so any stray prose or imperfect fence left the raw ``` reaching
 * JSON.parse ("Unexpected token '`'"). extractJsonContent must recover the JSON
 * in all these shapes. Every case must JSON.parse cleanly after extraction.
 */
const parse = (s: string) => JSON.parse(extractJsonContent(s));

describe('extractJsonContent', () => {
  it('passes through a bare JSON object unchanged', () => {
    expect(parse('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it('passes through a bare JSON array', () => {
    expect(parse('[{"x":1},{"y":2}]')).toEqual([{ x: 1 }, { y: 2 }]);
  });

  it('strips a clean ```json fence', () => {
    expect(parse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips a bare ``` fence (no json tag)', () => {
    expect(parse('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers JSON when the model adds prose AFTER the closing fence (the observed prod failure)', () => {
    expect(parse('```json\n{"a":1}\n```\nHope this helps!')).toEqual({ a: 1 });
  });

  it('recovers JSON when the model adds prose BEFORE the fence', () => {
    expect(parse('Sure! Here is the JSON:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers JSON when the closing fence has no preceding newline', () => {
    expect(parse('```json\n{"a":1}```')).toEqual({ a: 1 });
  });

  it('recovers a bare JSON object surrounded by prose (no fence)', () => {
    expect(parse('Here you go: {"a":1,"nested":{"z":9}} — done')).toEqual({ a: 1, nested: { z: 9 } });
  });

  it('handles leading/trailing whitespace', () => {
    expect(parse('\n\n  {"a":1}  \n')).toEqual({ a: 1 });
  });
});
