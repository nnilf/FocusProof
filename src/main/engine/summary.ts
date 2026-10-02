import type {
  Classification,
  DocumentSnapshot,
  FileProgress,
  SessionMetrics,
  TimelineBlock,
} from '@shared/types';

/** The subset of a stored interval that summaries need; keeps summary logic testable. */
export interface SummaryInterval {
  id: number;
  startTs: number;
  endTs: number;
  classification: Classification;
  combinedScore: number;
  focusScore: number | null;
  inputActivityScore: number | null;
  documentActivityScore: number | null;
  docChangeEvents: number;
}

export type SummarySnapshot = Pick<
  DocumentSnapshot,
  'path' | 'kind' | 'ts' | 'isBaseline' | 'words' | 'wordsAdded' | 'wordsRemoved' | 'linesAdded' | 'linesRemoved'
>;

/** Intervals separated by more than this are treated as discontinuous (e.g. a crash gap). */
export const MAX_CONTIGUOUS_GAP_MS = 2_000;
/** Distracted blocks shorter than this are not counted as separate "distraction periods". */
export const MIN_DISTRACTION_BLOCK_MS = 20_000;
/** Document activity at/above this level counts the interval as "editing". */
const EDITING_DOC_SCORE = 0.7;

const duration = (i: { startTs: number; endTs: number }): number => Math.max(0, i.endTs - i.startTs);

export function computeAltMs(
  breakdown: { productiveMs: number; neutralMs: number },
  neutralContribution: number,
): number {
  return breakdown.productiveMs + breakdown.neutralMs * Math.min(1, Math.max(0, neutralContribution));
}

export function intervalAltMs(i: SummaryInterval, neutralContribution: number): number {
  if (i.classification === 'productive') return duration(i);
  if (i.classification === 'neutral') return duration(i) * neutralContribution;
  return 0;
}

export function buildTimeline(intervals: readonly SummaryInterval[]): TimelineBlock[] {
  const sorted = [...intervals].sort((a, b) => a.startTs - b.startTs);
  const blocks: TimelineBlock[] = [];
  for (const i of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.classification === i.classification && i.startTs - last.endTs <= MAX_CONTIGUOUS_GAP_MS) {
      last.endTs = Math.max(last.endTs, i.endTs);
      last.intervalIds.push(i.id);
    } else {
      blocks.push({ classification: i.classification, startTs: i.startTs, endTs: i.endTs, intervalIds: [i.id] });
    }
  }
  return blocks;
}

export function summarizeDocuments(snapshots: readonly SummarySnapshot[]): FileProgress[] {
  const byPath = new Map<string, SummarySnapshot[]>();
  for (const s of [...snapshots].sort((a, b) => a.ts - b.ts)) {
    const list = byPath.get(s.path) ?? [];
    list.push(s);
    byPath.set(s.path, list);
  }
  const files: FileProgress[] = [];
  for (const [path, list] of byPath) {
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) continue;
    const edits = list.filter((s) => !s.isBaseline);
    const baseline = list.find((s) => s.isBaseline) ?? first;
    files.push({
      path,
      kind: last.kind,
      startWords: baseline.words,
      endWords: last.words,
      wordsAdded: edits.reduce((n, s) => n + s.wordsAdded, 0),
      wordsRemoved: edits.reduce((n, s) => n + s.wordsRemoved, 0),
      linesAdded: edits.reduce((n, s) => n + s.linesAdded, 0),
      linesRemoved: edits.reduce((n, s) => n + s.linesRemoved, 0),
      edits: edits.length,
    });
  }
  return files.sort((a, b) => b.edits - a.edits);
}

export interface SummarizeInput {
  sessionId: number;
  startedAt: number;
  endedAt: number;
  intervals: readonly SummaryInterval[];
  snapshots: readonly SummarySnapshot[];
  neutralContribution: number;
  now?: number;
}

export function summarizeSession(input: SummarizeInput): SessionMetrics {
  const { intervals, neutralContribution } = input;
  const totals = { productive: 0, neutral: 0, distracted: 0, away: 0 };
  let trackedMs = 0;
  let focusWeighted = 0;
  let focusMs = 0;
  let scoreWeighted = 0;
  let editingMs = 0;
  let readingMs = 0;

  for (const i of intervals) {
    const ms = duration(i);
    trackedMs += ms;
    totals[i.classification] += ms;
    scoreWeighted += i.combinedScore * ms;
    if (i.focusScore !== null && i.classification !== 'away') {
      focusWeighted += i.focusScore * ms;
      focusMs += ms;
    }
    if (i.classification === 'productive' || i.classification === 'neutral') {
      const editing = i.docChangeEvents > 0 || (i.documentActivityScore ?? 0) >= EDITING_DOC_SCORE;
      if (editing) editingMs += ms;
      else readingMs += ms;
    }
  }

  const timeline = buildTimeline(intervals);
  const productiveBlocks = timeline.filter((b) => b.classification === 'productive').map(duration);
  const distractionCount = timeline.filter(
    (b) => b.classification === 'distracted' && duration(b) >= MIN_DISTRACTION_BLOCK_MS,
  ).length;

  const files = summarizeDocuments(input.snapshots);
  const netWords = files.reduce(
    (n, f) => (f.startWords !== null && f.endWords !== null ? n + (f.endWords - f.startWords) : n),
    0,
  );

  const durationMs = Math.max(trackedMs, input.endedAt - input.startedAt);
  const altMs = computeAltMs({ productiveMs: totals.productive, neutralMs: totals.neutral }, neutralContribution);

  return {
    sessionId: input.sessionId,
    durationMs,
    trackedMs,
    untrackedMs: Math.max(0, durationMs - trackedMs),
    altMs,
    productiveMs: totals.productive,
    neutralMs: totals.neutral,
    distractedMs: totals.distracted,
    awayMs: totals.away,
    productivity: durationMs > 0 ? altMs / durationMs : 0,
    avgFocus: focusMs > 0 ? focusWeighted / focusMs : null,
    avgScore: trackedMs > 0 ? scoreWeighted / trackedMs : 0,
    longestProductiveMs: productiveBlocks.length ? Math.max(...productiveBlocks) : 0,
    distractionCount,
    avgProductiveBlockMs: productiveBlocks.length
      ? productiveBlocks.reduce((a, b) => a + b, 0) / productiveBlocks.length
      : 0,
    wordsAdded: files.reduce((n, f) => n + f.wordsAdded, 0),
    wordsRemoved: files.reduce((n, f) => n + f.wordsRemoved, 0),
    netWords,
    linesAdded: files.reduce((n, f) => n + f.linesAdded, 0),
    linesRemoved: files.reduce((n, f) => n + f.linesRemoved, 0),
    filesChanged: files.filter((f) => f.edits > 0).length,
    editingMs,
    readingMs,
    computedAt: input.now ?? Date.now(),
  };
}

/** Finds the window of the given length with the most Actual Learning Time (two-pointer sweep). */
export function mostProductiveWindow(
  intervals: readonly SummaryInterval[],
  windowMs: number,
  neutralContribution: number,
): { startTs: number; endTs: number; altMs: number } | null {
  const sorted = [...intervals].sort((a, b) => a.startTs - b.startTs);
  let best: { startTs: number; endTs: number; altMs: number } | null = null;
  let left = 0;
  let sum = 0;
  for (let right = 0; right < sorted.length; right++) {
    const r = sorted[right];
    if (!r) continue;
    sum += intervalAltMs(r, neutralContribution);
    while (left <= right) {
      const l = sorted[left];
      if (!l || r.endTs - l.startTs <= windowMs) break;
      sum -= intervalAltMs(l, neutralContribution);
      left++;
    }
    const l = sorted[left];
    if (l && sum > 0 && (!best || sum > best.altMs)) best = { startTs: l.startTs, endTs: r.endTs, altMs: sum };
  }
  return best;
}
