import { describe, expect, it } from 'vitest';
import type { Classification, SignalFrame } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { WeightedSignalEngine } from '../../src/main/engine/WeightedSignalEngine';
import { INITIAL_ENGINE_STATE } from '../../src/main/engine/LearningTimeEngine';
import { summarizeSession, type SummaryInterval } from '../../src/main/engine/summary';

const settings = DEFAULT_SETTINGS.engine;
const engine = new WeightedSignalEngine();
const T0 = 1_790_000_000_000;
const STEP = 5_000;

const word = { processName: 'WINWORD', title: 'Essay.docx - Word', category: 'productive' as const, relevance: 1, matchedRule: 'app: winword' };

/** Replays a session the way SessionManager does, including retroactive away relabelling. */
function replay(frames: SignalFrame[]): { classes: Classification[]; altMs: number } {
  let state = INITIAL_ENGINE_STATE;
  const intervals: SummaryInterval[] = [];
  frames.forEach((frame, i) => {
    const { evaluation, state: next } = engine.evaluate(frame, state, settings);
    state = next;
    intervals.push({
      id: i,
      startTs: frame.startTs,
      endTs: frame.endTs,
      classification: evaluation.classification,
      combinedScore: evaluation.combinedScore,
      focusScore: null,
      inputActivityScore: evaluation.signals.inputActivityScore,
      documentActivityScore: null,
      docChangeEvents: 0,
    });
    if (evaluation.awaySinceTs !== null) {
      for (const iv of intervals) if ((iv.startTs + iv.endTs) / 2 >= evaluation.awaySinceTs) iv.classification = 'away';
    }
  });
  const m = summarizeSession({
    sessionId: 1,
    startedAt: T0,
    endedAt: frames[frames.length - 1]?.endTs ?? T0,
    intervals,
    snapshots: [],
    neutralContribution: settings.neutralContribution,
  });
  return { classes: intervals.map((i) => i.classification), altMs: m.altMs };
}

function frames(count: number, make: (i: number) => Partial<SignalFrame>): SignalFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    startTs: T0 + i * STEP,
    endTs: T0 + (i + 1) * STEP,
    window: word,
    input: null,
    screen: null,
    camera: null,
    documents: null,
    ...make(i),
  }));
}

describe('away detection (regression: away from desk with Word focused)', () => {
  it('counts a 4-minute webcam-confirmed absence as away, not learning time', () => {
    const working = 4; // 20 s of activity first
    const absentFor = 48; // 4 minutes
    const session = frames(working + absentFor, (i) =>
      i < working
        ? { input: { keyboardEvents: 10, mouseEvents: 5, activeSeconds: 5, idleMs: 100 }, camera: { samples: 10, presence: 1, focus: 1, lookingAwayMs: 0, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null } }
        : {
            input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: (i - working + 1) * STEP },
            camera: { samples: 10, presence: 0, focus: 0, lookingAwayMs: STEP, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
          },
    );
    const { classes, altMs } = replay(session);
    expect(classes.slice(working).every((c) => c === 'away')).toBe(true);
    expect(altMs).toBe(working * STEP);
  });

  it('does not mark a short absence (under the threshold) as away', () => {
    const session = frames(8, () => ({
      input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 20_000 },
      camera: { samples: 10, presence: 0, focus: 0, lookingAwayMs: STEP, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
    }));
    expect(replay(session).classes).not.toContain('away');
  });

  it('ignores webcam absence while the user is typing (camera misdetection)', () => {
    const session = frames(30, () => ({
      input: { keyboardEvents: 20, mouseEvents: 5, activeSeconds: 5, idleMs: 100 },
      camera: { samples: 10, presence: 0, focus: 0, lookingAwayMs: STEP, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
    }));
    expect(replay(session).classes).not.toContain('away');
  });

  it('does not give reading grace while the webcam shows nobody there', () => {
    const { evaluation } = engine.evaluate(
      frames(1, () => ({
        window: { ...word, relevance: 0.8 },
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 30_000 },
        camera: { samples: 10, presence: 0, focus: 0, lookingAwayMs: STEP, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
      }))[0]!,
      { ...INITIAL_ENGINE_STATE, contextEma: 0 },
      settings,
    );
    expect(evaluation.reasons.some((r) => r.code === 'reading-grace')).toBe(false);
  });

  it('relabels the whole idle stretch when the no-camera idle threshold is reached', () => {
    const awaySteps = settings.awayThresholdSec * 1000 / STEP + 2;
    const session = frames(awaySteps, (i) => ({
      input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: (i + 1) * STEP },
    }));
    const { classes, altMs } = replay(session);
    expect(classes.every((c) => c === 'away')).toBe(true);
    expect(altMs).toBe(0);
  });
});
