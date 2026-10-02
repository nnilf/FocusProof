import { describe, expect, it } from 'vitest';
import type { Classification } from '@shared/types';
import {
  buildTimeline,
  computeAltMs,
  mostProductiveWindow,
  summarizeSession,
  type SummaryInterval,
  type SummarySnapshot,
} from '../../src/main/engine/summary';

const T0 = 1_700_000_000_000;
const STEP = 60_000;

function intervals(pattern: Classification[], extra: Partial<SummaryInterval> = {}): SummaryInterval[] {
  return pattern.map((classification, idx) => ({
    id: idx + 1,
    startTs: T0 + idx * STEP,
    endTs: T0 + (idx + 1) * STEP,
    classification,
    combinedScore: classification === 'productive' ? 0.8 : classification === 'neutral' ? 0.5 : 0.1,
    focusScore: null,
    inputActivityScore: 0.5,
    documentActivityScore: 0,
    docChangeEvents: 0,
    ...extra,
  }));
}

const base = { sessionId: 1, startedAt: T0, snapshots: [] as SummarySnapshot[], now: T0 };

describe('computeAltMs', () => {
  it('counts productive time fully and a proportion of neutral time', () => {
    expect(computeAltMs({ productiveMs: 60_000, neutralMs: 60_000 }, 0.5)).toBe(90_000);
    expect(computeAltMs({ productiveMs: 60_000, neutralMs: 60_000 }, 0)).toBe(60_000);
    expect(computeAltMs({ productiveMs: 60_000, neutralMs: 60_000 }, 1)).toBe(120_000);
  });

  it('clamps out-of-range neutral contribution', () => {
    expect(computeAltMs({ productiveMs: 0, neutralMs: 60_000 }, 2)).toBe(60_000);
    expect(computeAltMs({ productiveMs: 0, neutralMs: 60_000 }, -1)).toBe(0);
  });
});

describe('summarizeSession', () => {
  const pattern: Classification[] = [
    'productive',
    'productive',
    'neutral',
    'distracted',
    'productive',
    'productive',
    'productive',
    'away',
    'distracted',
    'neutral',
  ];
  const list = intervals(pattern);

  it('never counts distracted or away time as ALT', () => {
    const m = summarizeSession({ ...base, endedAt: T0 + 10 * STEP, intervals: list, neutralContribution: 0.5 });
    expect(m.productiveMs).toBe(5 * STEP);
    expect(m.neutralMs).toBe(2 * STEP);
    expect(m.distractedMs).toBe(2 * STEP);
    expect(m.awayMs).toBe(STEP);
    expect(m.altMs).toBe(6 * STEP);
    expect(m.durationMs).toBe(10 * STEP);
    expect(m.productivity).toBeCloseTo(0.6);
  });

  it('computes focus block statistics', () => {
    const m = summarizeSession({ ...base, endedAt: T0 + 10 * STEP, intervals: list, neutralContribution: 0.5 });
    expect(m.longestProductiveMs).toBe(3 * STEP);
    expect(m.avgProductiveBlockMs).toBe(2.5 * STEP);
    expect(m.distractionCount).toBe(2);
  });

  it('reports untracked time when the session has gaps', () => {
    const m = summarizeSession({ ...base, endedAt: T0 + 15 * STEP, intervals: list, neutralContribution: 0.5 });
    expect(m.trackedMs).toBe(10 * STEP);
    expect(m.untrackedMs).toBe(5 * STEP);
  });

  it('separates editing from reading time', () => {
    const editing = intervals(['productive', 'productive', 'neutral']).map((i, idx) => ({
      ...i,
      docChangeEvents: idx === 0 ? 2 : 0,
    }));
    const m = summarizeSession({ ...base, endedAt: T0 + 3 * STEP, intervals: editing, neutralContribution: 0.5 });
    expect(m.editingMs).toBe(STEP);
    expect(m.readingMs).toBe(2 * STEP);
  });

  it('aggregates document progress from snapshots', () => {
    const snapshots: SummarySnapshot[] = [
      { path: 'a.md', kind: 'text', ts: T0, isBaseline: true, words: 100, wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0 },
      { path: 'a.md', kind: 'text', ts: T0 + 1, isBaseline: false, words: 150, wordsAdded: 60, wordsRemoved: 10, linesAdded: 3, linesRemoved: 1 },
      { path: 'b.ts', kind: 'code', ts: T0, isBaseline: true, words: null, wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0 },
      { path: 'b.ts', kind: 'code', ts: T0 + 2, isBaseline: false, words: null, wordsAdded: 0, wordsRemoved: 0, linesAdded: 20, linesRemoved: 4 },
      { path: 'c.md', kind: 'text', ts: T0, isBaseline: true, words: 10, wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0 },
    ];
    const m = summarizeSession({ ...base, endedAt: T0 + STEP, intervals: [], snapshots, neutralContribution: 0.5 });
    expect(m.wordsAdded).toBe(60);
    expect(m.wordsRemoved).toBe(10);
    expect(m.netWords).toBe(50);
    expect(m.linesAdded).toBe(23);
    expect(m.linesRemoved).toBe(5);
    expect(m.filesChanged).toBe(2);
  });
});

describe('buildTimeline', () => {
  it('merges contiguous intervals of the same class', () => {
    const blocks = buildTimeline(intervals(['productive', 'productive', 'neutral', 'productive']));
    expect(blocks.map((b) => b.classification)).toEqual(['productive', 'neutral', 'productive']);
    expect(blocks[0]?.intervalIds).toEqual([1, 2]);
  });

  it('splits blocks across gaps', () => {
    const list = intervals(['productive', 'productive']);
    list[1] = { ...list[1]!, startTs: list[1]!.startTs + 10 * STEP, endTs: list[1]!.endTs + 10 * STEP };
    expect(buildTimeline(list)).toHaveLength(2);
  });
});

describe('mostProductiveWindow', () => {
  it('finds the window with the most ALT', () => {
    const list = intervals(['distracted', 'productive', 'productive', 'productive', 'neutral', 'away']);
    const best = mostProductiveWindow(list, 3 * STEP, 0.5);
    expect(best?.startTs).toBe(T0 + STEP);
    expect(best?.altMs).toBe(3 * STEP);
  });

  it('returns null when nothing was productive', () => {
    expect(mostProductiveWindow(intervals(['away', 'distracted']), STEP, 0.5)).toBeNull();
  });
});
