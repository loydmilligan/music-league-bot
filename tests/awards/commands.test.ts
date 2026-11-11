import { describe, expect, it } from 'vitest';
import { parseAwardCommand } from '../../src/awards/commands.js';

const P = ['bbb', 'hba'];

describe('parseAwardCommand', () => {
  it('parses the bare award flag', () => {
    expect(parseAwardCommand('bbb', P)).toEqual({ award: 'bbb', kind: 'flag' });
    expect(parseAwardCommand('hba', P)).toEqual({ award: 'hba', kind: 'flag' });
  });

  it('parses candidates as list', () => {
    expect(parseAwardCommand('bbb candidates', P)).toEqual({ award: 'bbb', kind: 'list' });
    expect(parseAwardCommand('hba candidates', P)).toEqual({ award: 'hba', kind: 'list' });
  });

  it('parses place picks in every place form', () => {
    expect(parseAwardCommand('bbb-1 5', P)).toEqual({ award: 'bbb', kind: 'pick', place: 1, n: 5 });
    expect(parseAwardCommand('bbb-1st 5', P)).toEqual({ award: 'bbb', kind: 'pick', place: 1, n: 5 });
    expect(parseAwardCommand('bbb-first 5', P)).toEqual({ award: 'bbb', kind: 'pick', place: 1, n: 5 });
    expect(parseAwardCommand('hba-2 7', P)).toEqual({ award: 'hba', kind: 'pick', place: 2, n: 7 });
    expect(parseAwardCommand('hba-2nd 7', P)).toEqual({ award: 'hba', kind: 'pick', place: 2, n: 7 });
    expect(parseAwardCommand('hba-second 7', P)).toEqual({ award: 'hba', kind: 'pick', place: 2, n: 7 });
    expect(parseAwardCommand('bbb-3 1', P)).toEqual({ award: 'bbb', kind: 'pick', place: 3, n: 1 });
    expect(parseAwardCommand('bbb-3rd 1', P)).toEqual({ award: 'bbb', kind: 'pick', place: 3, n: 1 });
    expect(parseAwardCommand('bbb-third 1', P)).toEqual({ award: 'bbb', kind: 'pick', place: 3, n: 1 });
  });

  it('is case-insensitive and trims, output prefix lowercase', () => {
    expect(parseAwardCommand('  BBB-SECOND 3  ', P)).toEqual({ award: 'bbb', kind: 'pick', place: 2, n: 3 });
    expect(parseAwardCommand('HBA', P)).toEqual({ award: 'hba', kind: 'flag' });
    expect(parseAwardCommand('Bbb Candidates', P)).toEqual({ award: 'bbb', kind: 'list' });
  });

  it('parses a bare number as choose', () => {
    expect(parseAwardCommand('bbb 2', P)).toEqual({ award: 'bbb', kind: 'choose', n: 2 });
    expect(parseAwardCommand('hba 11', P)).toEqual({ award: 'hba', kind: 'choose', n: 11 });
  });

  it('parses poster', () => {
    expect(parseAwardCommand('bbb poster', P)).toEqual({ award: 'bbb', kind: 'poster' });
    expect(parseAwardCommand('HBA Poster', P)).toEqual({ award: 'hba', kind: 'poster' });
  });

  it('parses approve with and without an award', () => {
    expect(parseAwardCommand('approve', P)).toEqual({ award: null, kind: 'approve' });
    expect(parseAwardCommand('APPROVE', P)).toEqual({ award: null, kind: 'approve' });
    expect(parseAwardCommand('bbb approve', P)).toEqual({ award: 'bbb', kind: 'approve' });
    expect(parseAwardCommand('hba approve', P)).toEqual({ award: 'hba', kind: 'approve' });
  });

  it('returns null for non-matching text', () => {
    expect(parseAwardCommand('bbb-4 1', P)).toBeNull();
    expect(parseAwardCommand('bbb-1', P)).toBeNull();
    expect(parseAwardCommand('bbb-1 x', P)).toBeNull();
    expect(parseAwardCommand('bbbx', P)).toBeNull();
    expect(parseAwardCommand('hey bbb', P)).toBeNull();
    expect(parseAwardCommand('approve this', P)).toBeNull();
    expect(parseAwardCommand('xyz', P)).toBeNull();
    expect(parseAwardCommand('', P)).toBeNull();
  });

  it('only matches configured prefixes', () => {
    expect(parseAwardCommand('zzz', P)).toBeNull();
    expect(parseAwardCommand('zzz 2', P)).toBeNull();
    expect(parseAwardCommand('bbb', ['hba'])).toBeNull();
  });
});

describe('redo', () => {
  it('parses redo with and without a comment, keeping the comment case', () => {
    expect(parseAwardCommand('hba redo', ['bbb', 'hba'])).toEqual({ award: 'hba', kind: 'redo', comment: null });
    expect(parseAwardCommand('HBA redo Make Koz look happier', ['bbb', 'hba'])).toEqual({ award: 'hba', kind: 'redo', comment: 'Make Koz look happier' });
    expect(parseAwardCommand('hba redone', ['bbb', 'hba'])).toBeNull();
  });
});
