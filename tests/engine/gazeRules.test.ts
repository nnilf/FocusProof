import { describe, expect, it } from 'vitest';
import type { CameraObservation, EngineSettings, SignalFrame } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { settingsPatchSchema } from '@shared/ipc/schemas';
import { WeightedSignalEngine } from '../../src/main/engine/WeightedSignalEngine';
import { INITIAL_ENGINE_STATE } from '../../src/main/engine/LearningTimeEngine';
import { FocusAnalyzer, attentionFromPose, classifyGaze, type ZoneLike } from '../../src/main/monitoring/focus/FocusAnalyzer';
import { correctedEyeGain, eyeDirection, eyeXSign, fitEyeGain, gazeOf, NO_EYE_GAIN } from '@shared/focus/gaze';
import type { GazePoint } from '@shared/types';
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

describe('multi-point calibration with eye direction', () => {
  // A laptop with a monitor just above it: the head barely tilts between them, the eyes do the moving.
  const SPOTS = [-1, -0.5, 0, 0.5, 1];
  const grid = (pitch: number, eyeY: number): GazePoint[] =>
    SPOTS.flatMap((s, i) => [
      { yawDeg: s * 10, pitchDeg: pitch + (i % 2 ? 2 : -2), eyeX: s * 0.2, eyeY: eyeY - 0.15 },
      { yawDeg: s * 10, pitchDeg: pitch + (i % 2 ? -2 : 2), eyeX: s * 0.2, eyeY: eyeY + 0.15 },
    ]);
  const zone = (label: string, displayId: number, points: GazePoint[]): ZoneLike => ({
    kind: 'screen',
    displayId,
    label,
    yawDeg: 0,
    pitchDeg: points[0]?.pitchDeg ?? 0,
    points,
  });
  const monitor = zone('monitor', 2, grid(2, -0.35));
  const laptop = zone('laptop', 1, grid(5, 0.35));
  const desk = [monitor, laptop];

  it('fits a vertical eye gain when head pitch alone cannot separate the screens', () => {
    const gain = fitEyeGain(desk);
    expect(gain.y).toBeGreaterThan(0);
    // Head 4° down, eyes looking up: the monitor, which head pose alone reads as the laptop.
    expect(classifyGaze(0, 4, desk, 25).zone?.label).toBe('laptop');
    expect(classifyGaze(0, 4, desk, 25, { eyeX: 0, eyeY: -0.35, gain }).zone?.label).toBe('monitor');
    expect(classifyGaze(0, 3, desk, 25, { eyeX: 0, eyeY: 0.35, gain }).zone?.label).toBe('laptop');
  });

  it('keeps head pose only without eye data', () => {
    const headOnly = desk.map((z) => ({ ...z, points: z.points?.map((p) => ({ ...p, eyeX: null, eyeY: null })) }));
    expect(fitEyeGain(headOnly)).toEqual(NO_EYE_GAIN);
    expect(fitEyeGain(zones)).toEqual(NO_EYE_GAIN);
  });

  it('counts anywhere within the calibrated corners as full attention', () => {
    const wide = zone('wide', 3, [
      { yawDeg: -20, pitchDeg: -5, eyeX: null, eyeY: null },
      { yawDeg: 20, pitchDeg: 5, eyeX: null, eyeY: null },
    ]);
    expect(attentionFromPose(18, 4, 10, [wide])).toBe(1);
    expect(attentionFromPose(35, 0, 10, [wide])).toBe(0);
  });

  it('reads eye direction from blendshapes, signed like head pose', () => {
    const shapes = (o: Record<string, number>) =>
      ['eyeLookOutLeft', 'eyeLookInLeft', 'eyeLookOutRight', 'eyeLookInRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight'].map(
        (categoryName) => ({ categoryName, score: o[categoryName] ?? 0 }),
      );
    expect(eyeDirection(shapes({ eyeLookDownLeft: 0.6, eyeLookDownRight: 0.6 }))?.eyeY).toBeCloseTo(0.6);
    expect(eyeDirection(shapes({ eyeLookUpLeft: 0.4, eyeLookUpRight: 0.4 }))?.eyeY).toBeCloseTo(-0.4);
    expect(eyeDirection([])).toBeNull();
  });

  it('accepts samples and stored zones with and without eye data', () => {
    const parsed = settingsPatchSchema.parse({ camera: { zones: [{ kind: 'screen', displayId: 1, label: 'laptop', yawDeg: 0, pitchDeg: 5, points: laptop.points }], eyeGain: { x: 0, y: 1 } } });
    expect(parsed.camera?.zones?.[0]?.points).toHaveLength(10);
    const targeted = settingsPatchSchema.parse({ camera: { zones: [{ kind: 'screen', displayId: 1, label: 'laptop', yawDeg: 0, pitchDeg: 5, points: [{ yawDeg: 0, pitchDeg: 0, eyeX: 0, eyeY: 0, targetX: 0.1, targetY: 0.9 }] }] } });
    expect(targeted.camera?.zones?.[0]?.points?.[0]).toMatchObject({ targetX: 0.1, targetY: 0.9 });
  });
});

describe('horizontal eye direction', () => {
  // Two displays side by side; looking across each one, the head does half the turn and the eyes the rest.
  const TARGETS = [0.1, 0.5, 0.9].flatMap((tx) => [0.1, 0.5, 0.9].map((ty) => ({ tx, ty })));
  const display = (label: string, displayId: number, centreYaw: number, eyeSign: number, withTargets = true): ZoneLike => {
    const points: GazePoint[] = TARGETS.map(({ tx, ty }) => ({
      yawDeg: centreYaw + (0.5 - tx) * 15,
      pitchDeg: (ty - 0.5) * 10,
      eyeX: eyeSign * (0.5 - tx) * 0.5,
      eyeY: 0,
      ...(withTargets ? { targetX: tx, targetY: ty } : {}),
    }));
    return { kind: 'screen', displayId, label, yawDeg: centreYaw, pitchDeg: 0, points };
  };
  const desk = (eyeSign: number, withTargets = true): ZoneLike[] => [
    display('left', 1, 22, eyeSign, withTargets),
    display('right', 2, -22, eyeSign, withTargets),
  ];
  const leftEdge = (z: ZoneLike) => z.points?.find((p) => p.targetX === 0.1 && p.targetY === 0.5) as GazePoint;
  const rightEdge = (z: ZoneLike) => z.points?.find((p) => p.targetX === 0.9 && p.targetY === 0.5) as GazePoint;

  it('reads the sign from where the dots were', () => {
    expect(eyeXSign(desk(1))).toBe(1);
    expect(eyeXSign(desk(-1))).toBe(-1);
  });

  it('falls back to the head turn for calibrations without dot positions', () => {
    expect(eyeXSign(desk(1, false))).toBe(1);
    expect(eyeXSign(desk(-1, false))).toBe(-1);
  });

  describe('calibrations saved with a reversed gain', () => {
    // A real calibration from before dot positions were recorded: a display to the left, the main
    // one ahead and a laptop on the left, saved with the reversed gain the old fit picked.
    const pt = (yawDeg: number, pitchDeg: number, eyeX: number, eyeY: number): GazePoint => ({ yawDeg, pitchDeg, eyeX, eyeY });
    const saved: ZoneLike[] = [
      { kind: 'screen', displayId: 1, label: 'display 1', yawDeg: 26, pitchDeg: 8.8, points: [pt(26, 8.8, 0.038, 0.068), pt(35.9, 6.6, 0.427, 0.095), pt(31.1, 6.4, 0.098, 0.09), pt(18.7, 3.2, 0.003, -0.057), pt(19.2, 13.1, -0.036, -0.009), pt(29.3, 17.8, 0.25, 0.208), pt(39.7, 16.3, 0.428, 0.453)] },
      { kind: 'screen', displayId: 2, label: 'display 2 (main)', yawDeg: -2.7, pitchDeg: 6.7, points: [pt(-2.7, 6.7, 0.125, 0.045), pt(9.5, 2.4, 0.177, 0.088), pt(-2.4, 1.8, 0.158, 0.123), pt(-14, 0.7, 0.18, 0.097), pt(-13.8, 11.3, 0.116, 0.107), pt(-1.2, 11.6, 0.097, 0.065), pt(11.9, 11.9, -0.016, -0.031)] },
      { kind: 'distraction', displayId: null, label: 'Laptop', yawDeg: 33, pitchDeg: 14, points: [pt(32.5, 13.5, 0.583, 0.078), pt(33, 14, 0.518, 0.471), pt(29.3, 19.1, 0.231, 0.453)] },
    ];

    it('refits a reversed gain', () => {
      const fixed = correctedEyeGain(saved, { x: -1, y: 0 });
      expect(fixed).not.toBeNull();
      expect(fixed?.x).toBeGreaterThanOrEqual(0);
    });

    it('leaves a gain that matches the eyes, or ignores them, alone', () => {
      expect(correctedEyeGain(saved, { x: 0.5, y: 0 })).toBeNull();
      expect(correctedEyeGain(saved, { x: 0, y: 0.25 })).toBeNull();
    });
  });

  it('never fits a gain that moves the gaze against the eyes', () => {
    for (const eyeSign of [1, -1]) {
      const zones = desk(eyeSign);
      const gain = fitEyeGain(zones);
      expect(Math.sign(gain.x) * eyeSign).not.toBe(-1);
      for (const z of zones) {
        // Looking left of the display reads further left (higher yaw) than looking right of it.
        expect(gazeOf(leftEdge(z), gain).x).toBeGreaterThan(gazeOf(rightEdge(z), gain).x);
      }
    }
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
