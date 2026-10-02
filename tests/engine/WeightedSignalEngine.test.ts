import { describe, expect, it } from 'vitest';
import type { EngineSettings, SignalFrame } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { WeightedSignalEngine, classifyScore, weightSignals } from '../../src/main/engine/WeightedSignalEngine';
import { INITIAL_ENGINE_STATE, type EngineState } from '../../src/main/engine/LearningTimeEngine';

const settings: EngineSettings = DEFAULT_SETTINGS.engine;
const engine = new WeightedSignalEngine();
const T0 = 1_700_000_000_000;

function frame(overrides: Partial<SignalFrame> = {}): SignalFrame {
  return {
    startTs: T0,
    endTs: T0 + 5_000,
    window: { processName: 'code', title: 'essay.md', category: 'productive', relevance: 1, matchedRule: 'app: code' },
    input: { keyboardEvents: 15, mouseEvents: 3, activeSeconds: 5, idleMs: 200 },
    screen: null,
    camera: null,
    documents: {
      changeEvents: 1,
      msSinceLastChange: 0,
      wordsAdded: 12,
      wordsRemoved: 1,
      linesAdded: 1,
      linesRemoved: 0,
      filesChanged: ['essay.md'],
    },
    ...overrides,
  };
}

const run = (f: SignalFrame, state: EngineState = INITIAL_ENGINE_STATE, s: EngineSettings = settings) =>
  engine.evaluate(f, state, s);

describe('classifyScore', () => {
  it('uses configured thresholds inclusively', () => {
    expect(classifyScore(0.6, settings)).toBe('productive');
    expect(classifyScore(0.599, settings)).toBe('neutral');
    expect(classifyScore(0.35, settings)).toBe('neutral');
    expect(classifyScore(0.34, settings)).toBe('distracted');
  });

  it('respects custom thresholds', () => {
    const strict = { ...settings, productiveThreshold: 0.9, neutralThreshold: 0.5 };
    expect(classifyScore(0.8, strict)).toBe('neutral');
    expect(classifyScore(0.45, strict)).toBe('distracted');
  });
});

describe('weightSignals', () => {
  const allSignals = {
    activeWindowRelevance: 1,
    screenRelevanceScore: null,
    inputActivityScore: 1,
    documentActivityScore: 1,
    focusScore: 1,
    presenceScore: 1,
    contextScore: 1,
  };

  it('produces 1 when every signal is maximal', () => {
    expect(weightSignals(allSignals, settings.weights).score).toBeCloseTo(1);
  });

  it('renormalises weights when the camera is unavailable', () => {
    const { score, contributions } = weightSignals(
      { ...allSignals, focusScore: null, presenceScore: null, documentActivityScore: 0 },
      settings.weights,
    );
    const camera = contributions.find((c) => c.key === 'camera');
    expect(camera?.effectiveWeight).toBe(0);
    const totalEffective = contributions.reduce((s, c) => s + c.effectiveWeight, 0);
    expect(totalEffective).toBeCloseTo(1);
    // relevance .3 + input .2 + context .1 over a total of .85
    expect(score).toBeCloseTo(0.6 / 0.85);
  });

  it('returns null when no signal is available', () => {
    const none = {
      activeWindowRelevance: null,
      screenRelevanceScore: null,
      inputActivityScore: null,
      documentActivityScore: null,
      focusScore: null,
      presenceScore: null,
      contextScore: null,
    };
    expect(weightSignals(none, settings.weights).score).toBeNull();
  });

  it('blends window and screen relevance', () => {
    const { contributions } = weightSignals(
      { ...allSignals, activeWindowRelevance: 1, screenRelevanceScore: 0.5 },
      settings.weights,
    );
    expect(contributions.find((c) => c.key === 'relevance')?.value).toBeCloseTo(0.8);
  });
});

describe('WeightedSignalEngine.evaluate', () => {
  it('classifies active editing in a productive app as productive', () => {
    const { evaluation } = run(frame());
    expect(evaluation.classification).toBe('productive');
    expect(evaluation.combinedScore).toBeGreaterThan(0.8);
    expect(evaluation.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['relevant-app', 'doc-change']));
  });

  it('works without the webcam (camera signals null)', () => {
    const { evaluation } = run(frame({ camera: null }));
    expect(evaluation.signals.presenceScore).toBeNull();
    expect(evaluation.classification).toBe('productive');
  });

  it('caps distracting applications below the neutral threshold', () => {
    const { evaluation } = run(
      frame({
        window: { processName: 'chrome', title: 'YouTube', category: 'distracting', relevance: 0, matchedRule: 'youtube' },
        documents: { ...frame().documents!, changeEvents: 0, msSinceLastChange: null, wordsAdded: 0, wordsRemoved: 0 },
      }),
    );
    expect(evaluation.classification).toBe('distracted');
    expect(evaluation.reasons.some((r) => r.code === 'distracting-content')).toBe(true);
  });

  it('classifies long idle periods without camera presence as away', () => {
    const { evaluation } = run(
      frame({
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: settings.awayThresholdSec * 1000 + 1 },
        documents: { ...frame().documents!, changeEvents: 0, msSinceLastChange: 600_000 },
      }),
    );
    expect(evaluation.classification).toBe('away');
    expect(evaluation.combinedScore).toBe(0);
  });

  it('does not mark away while the webcam sees the user (e.g. reading on paper)', () => {
    const { evaluation } = run(
      frame({
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: settings.awayThresholdSec * 1000 + 1 },
        camera: { samples: 10, presence: 1, focus: 0.9, lookingAwayMs: 0, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
        documents: null,
      }),
    );
    expect(evaluation.classification).not.toBe('away');
  });

  it('marks away after the webcam reports absence for the away threshold', () => {
    let state: EngineState = INITIAL_ENGINE_STATE;
    const absent = frame({
      input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 10_000 },
      camera: { samples: 10, presence: 0, focus: 0, lookingAwayMs: 5_000, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null },
      documents: null,
    });
    const ticks = (settings.awayThresholdSec * 1000) / 5_000;
    let last = run(absent, state);
    for (let i = 0; i < ticks; i++) {
      last = run(absent, state);
      state = last.state;
    }
    expect(last.evaluation.classification).toBe('away');
  });

  it('applies the reading grace period to study material with no input', () => {
    const { evaluation } = run(
      frame({
        window: { processName: 'chrome', title: 'JSTOR – paper.pdf', category: 'productive', relevance: 0.8, matchedRule: 'keyword: jstor' },
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 90_000 },
        documents: { ...frame().documents!, changeEvents: 0, msSinceLastChange: null },
      }),
      { contextEma: 0, absentMs: 0, absentSinceTs: null, intervalsEvaluated: 10 },
    );
    expect(evaluation.classification).toBe('neutral');
    expect(evaluation.reasons.some((r) => r.code === 'reading-grace')).toBe(true);
  });

  it('marks prolonged inactivity on a non-study app as distracted', () => {
    const { evaluation } = run(
      frame({
        window: { processName: 'chrome', title: 'Some page', category: 'neutral', relevance: 0.5, matchedRule: null },
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: settings.inactivityThresholdSec * 1000 + 1 },
        documents: { ...frame().documents!, changeEvents: 0, msSinceLastChange: null },
      }),
    );
    expect(evaluation.classification).toBe('distracted');
    expect(evaluation.reasons.some((r) => r.code === 'prolonged-inactivity')).toBe(true);
  });

  it('does not treat a short reading pause as inactivity', () => {
    const { evaluation } = run(
      frame({
        window: { processName: 'chrome', title: 'Some page', category: 'neutral', relevance: 0.5, matchedRule: null },
        input: { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 30_000 },
        documents: null,
      }),
      { contextEma: 0.7, absentMs: 0, absentSinceTs: null, intervalsEvaluated: 10 },
    );
    expect(evaluation.reasons.some((r) => r.code === 'prolonged-inactivity')).toBe(false);
  });

  it('describes webcam focus in three bands', () => {
    const codeFor = (focus: number) =>
      run(frame({ camera: { samples: 10, presence: 1, focus, lookingAwayMs: 0, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null } })).evaluation.reasons.find((r) =>
        r.code.startsWith('camera'),
      )?.code;
    expect(codeFor(0.95)).toBe('camera-focused');
    expect(codeFor(0.5)).toBe('camera-partial');
    expect(codeFor(0.2)).toBe('camera-looking-away');
  });

  it('updates the context EMA from the combined score', () => {
    const first = run(frame());
    expect(first.state.contextEma).toBeCloseTo(first.evaluation.combinedScore);
    const second = run(frame(), first.state);
    expect(second.evaluation.signals.contextScore).toBeCloseTo(first.evaluation.combinedScore);
    expect(second.state.intervalsEvaluated).toBe(2);
  });
});
