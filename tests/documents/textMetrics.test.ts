import { describe, expect, it } from 'vitest';
import {
  computeTextDelta,
  countLines,
  countWords,
  documentKind,
} from '../../src/main/monitoring/documents/textMetrics';

describe('countWords', () => {
  it('counts words including contractions and numbers', () => {
    expect(countWords("It's a test of 42 words — really?")).toBe(7);
    expect(countWords('')).toBe(0);
    expect(countWords('  # Heading\n\n- item one')).toBe(3);
  });
});

describe('countLines', () => {
  it('ignores a trailing newline', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\r\nb')).toBe(2);
    expect(countLines('')).toBe(0);
  });
});

describe('computeTextDelta', () => {
  it('counts appended words and lines', () => {
    const d = computeTextDelta('Hello world\n', 'Hello world\nA new sentence here.\n');
    expect(d).toEqual({ wordsAdded: 4, wordsRemoved: 0, linesAdded: 1, linesRemoved: 0 });
  });

  it('counts only the changed words within an edited paragraph', () => {
    const before = 'The quick brown fox jumps over the lazy dog.\n';
    const after = 'The quick red fox jumps over the sleepy dog.\n';
    const d = computeTextDelta(before, after);
    expect(d.wordsAdded).toBe(2);
    expect(d.wordsRemoved).toBe(2);
    expect(d.linesAdded).toBe(1);
    expect(d.linesRemoved).toBe(1);
  });

  it('counts removals', () => {
    const d = computeTextDelta('one two\nthree four\n', 'one two\n');
    expect(d.wordsRemoved).toBe(2);
    expect(d.linesRemoved).toBe(1);
  });

  it('returns zeros for identical content', () => {
    expect(computeTextDelta('same', 'same')).toEqual({ wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0 });
  });
});

describe('documentKind', () => {
  it('classifies by extension', () => {
    expect(documentKind('C:/a/essay.MD')).toBe('text');
    expect(documentKind('report.docx')).toBe('docx');
    expect(documentKind('main.py')).toBe('code');
    expect(documentKind('image.png')).toBe('other');
  });
});
