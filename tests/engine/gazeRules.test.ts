import { describe, expect, it } from 'vitest';
import type { CameraObservation, EngineSettings, SignalFrame } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { settingsPatchSchema } from '@shared/ipc/schemas';
import { WeightedSignalEngine } from '../../src/main/engine/WeightedSignalEngine';
import { INITIAL_ENGINE_STATE } from '../../src/main/engine/LearningTimeEngine';
import { FocusAnalyzer, attentionFromPose, classifyGaze, type ZoneLike } from '../../src/main/monitoring/focus/FocusAnalyzer';
import { buildInsights } from '../../src/main/services/InsightService';
import { summarizeSession } from '../../src/main/engine/summary';

// The user's desk: main monitor ahead, second monitor to the left, laptop below the left monitor.
const zones: ZoneLike[] = [
  { kind: 'screen', label: 'display 2 (main)', yawDeg: 2, pitchDeg: -8 },
  { kind: 'screen', label: 'display 1', yawDeg: 38, pitchDeg: -6 },
  { kind: 'distraction', label: 'Laptop', yawDeg: 35, pitchDeg: -32 },
];

describe('classifyGaze', () => {
  it('separates the laptop from the monitor above it by head pitch', () => {
    expect(classifyGaze(37, -8, zones, 25).target).toBe('screen');
    expect(classifyGaze(36, -30, zones, 25)).toMatchObject({ target: 'distraction', zone: { label: 'Laptop' } });
  });

  it('reports off-screen beyond the tolerance from every zone', () => {
    expect(classifyGaze(-40, 0, zones, 25).target).toBe('offscreen');
  });

  it('gives zero attention while looking at a distraction area', () => {
    expect(attentionFromPose(36, -30, 25, zones)).toBe(0);
    expect(attentionFromPose(38, -6, 25, zones)).toBe(1);
  });

  it('falls back to straight ahead when no screen is calibrated', () => {
    expect(classifyGaze(0, 0, [{ kind: 'distraction', label: 'TV', yawDeg: -45, pitchDeg: 0 }], 25).target).toBe('screen');
  });
});

const engine = new WeightedSignalEngine();
const T0 = 1_790_000_000_000;
const word = { processName: 'WINWORD', title: 'Essay.docx - Word', domain: null, category: 'productive' as const, relevance: 1, matchedRule: 'app: winword' };
const idleInput = { keyboardEvents: 0, mouseEvents: 0, activeSeconds: 0, idleMs: 20_000 };
const typing = { keyboardEvents: 30, mouseEvents: 5, activeSeconds: 5, idleMs: 100 };

function camera(overrides: Partial<CameraObservation>): CameraObservation {
  return { samples: 10, presence: 1, focus: 0, lookingAwayMs: 5_000, distractionRatio: 0, offScreenRatio: 0, distractionLabel: null, workAreaLabel: null, ...overrides };
}

function evaluate(cam: CameraObservation, input = idleInput, settings: EngineSettings = DEFAULT_SETTINGS.engine) {
  const frame: SignalFrame = { startTs: T0, endTs: T0 + 5_000, window: word, input, screen: null, camera: cam, documents: null };
  return engine.evaluate(frame, { ...INITIAL_ENGINE_STATE, contextEma: 0.7 }, settings).evaluation;
}

describe('gaze rules in the engine', () => {
  it('marks watching the laptop as distracted even with Word focused', () => {
    const ev = evaluate(camera({ distractionRatio: 0.8, distractionLabel: 'Laptop' }));
    expect(ev.classification).toBe('distracted');
    expect(ev.reasons.find((r) => r.code === 'looking-at-distraction')?.text).toBe('Looking at Laptop');
  });

  it('does not penalise a glance at the laptop while typing', () => {
    const ev = evaluate(camera({ distractionRatio: 0.8, distractionLabel: 'Laptop', focus: 0.3 }), typing);
    expect(ev.classification).not.toBe('distracted');
  });

  it('applies each off-screen policy', () => {
    const offscreen = camera({ offScreenRatio: 1 });
    const policy = (offScreenPolicy: EngineSettings['offScreenPolicy']) =>
      evaluate(offscreen, idleInput, { ...DEFAULT_SETTINGS.engine, offScreenPolicy });
    expect(policy('distracted').classification).toBe('distracted');
    const neutral = policy('neutral');
    expect(neutral.classification).not.toBe('productive');
    expect(neutral.reasons.some((r) => r.code === 'reading-grace')).toBe(false);
    expect(policy('ignore').reasons.some((r) => r.code === 'looking-off-screen')).toBe(false);
  });
});

describe('work areas', () => {
  const withNotepad: ZoneLike[] = [...zones, { kind: 'screen', displayId: null, label: 'Notepad', yawDeg: 0, pitchDeg: -42 }];

  it('counts looking at a notepad as focused, separate from the laptop and main screen', () => {
    expect(classifyGaze(1, -40, withNotepad, 25)).toMatchObject({ target: 'screen', zone: { label: 'Notepad' } });
    expect(classifyGaze(36, -30, withNotepad, 25).zone?.label).toBe('Laptop');
    expect(classifyGaze(2, -10, withNotepad, 25).zone?.label).toBe('display 2 (main)');
    expect(attentionFromPose(1, -40, 25, withNotepad)).toBe(1);
  });

  it('reports the work area when it is looked at for most of an interval', () => {
    const analyzer = new FocusAnalyzer(25, 2);
    analyzer.configure(25, 2, withNotepad.map((z) => ({ kind: z.kind ?? 'screen', displayId: z.displayId === undefined ? 1 : z.displayId, label: z.label ?? '', yawDeg: z.yawDeg, pitchDeg: z.pitchDeg })));
    analyzer.setStatus('active', null);
    for (let i = 0; i < 10; i++) analyzer.record({ ts: i, facePresent: true, yawDeg: 0, pitchDeg: -41 });
    const obs = analyzer.drain();
    expect(obs?.workAreaLabel).toBe('Notepad');
    expect(obs?.offScreenRatio).toBe(0);
    const ev = evaluate(camera({ focus: 1, workAreaLabel: 'Notepad' }));
    expect(ev.reasons.some((r) => r.code === 'camera-work-area' && r.text.startsWith('Looking at Notepad'))).toBe(true);
  });
});

describe('stored calibrations', () => {
  it('treats zones saved before distraction areas existed as screens', () => {
    const parsed = settingsPatchSchema.parse({ camera: { zones: [{ displayId: 1, label: 'display 1', yawDeg: 0, pitchDeg: 0 }] } });
    expect(parsed.camera?.zones?.[0]?.kind).toBe('screen');
  });
});

describe('word-rate insight', () => {
  const metrics = (netWords: number, productiveMs: number) => ({
    ...summarizeSession({ sessionId: 1, startedAt: T0, endedAt: T0 + productiveMs, intervals: [], snapshots: [], neutralContribution: 0.5 }),
    netWords,
    productiveMs,
  });
  const insight = (netWords: number, productiveMs: number) =>
    buildInsights({
      metrics: metrics(netWords, productiveMs),
      assignmentName: null,
      assignmentTotalAltMs: null,
      assignmentAvgProductivity: null,
      assignmentOtherSessions: 0,
      mostProductive: null,
    }).find((i) => i.id === 'words-rate')?.text;

  it('does not extrapolate a rate from a handful of words (regression: 1285 min per 500 words)', () => {
    expect(insight(1, 154_000)).toBe('+1 net words in 3 min of productive time.');
  });

  it('shows the per-500 rate once there is enough writing', () => {
    expect(insight(500, 30 * 60_000)).toBe('30 min of productive time per 500 net words this session.');
  });
});
