import { attentionFromPose, classifyGaze, NO_EYE_GAIN, type EyeContext } from '@shared/focus/gaze';
import type { CameraObservation, CameraState, EyeGain, FocusZone } from '@shared/types';

export interface CameraSample {
  ts: number;
  facePresent: boolean;
  yawDeg: number | null;
  pitchDeg: number | null;
  /** Eye direction within the head; absent from older camera windows. */
  eyeX?: number | null;
  eyeY?: number | null;
}

export { angleToNearestZone, attentionFromPose, classifyGaze, type GazeTarget, type ZoneLike } from '@shared/focus/gaze';

const eyeOf = (s: CameraSample, gain: EyeGain): EyeContext => ({ eyeX: s.eyeX ?? null, eyeY: s.eyeY ?? null, gain });

/** Aggregates derived webcam samples (never images) into per-interval presence and focus. */
export class FocusAnalyzer {
  private samples: CameraSample[] = [];
  state: CameraState = 'off';
  message: string | null = null;
  private lastFocus: number | null = null;
  private zones: FocusZone[] = [];
  private eyeGain: EyeGain = NO_EYE_GAIN;
  /** Extra raw-sample consumer (used by calibration). */
  rawListener: ((sample: CameraSample) => void) | null = null;

  constructor(
    private lookAwayDeg: number,
    private samplesPerSecond: number,
  ) {}

  configure(lookAwayDeg: number, samplesPerSecond: number, zones: FocusZone[], eyeGain: EyeGain = NO_EYE_GAIN): void {
    this.lookAwayDeg = lookAwayDeg;
    this.samplesPerSecond = samplesPerSecond;
    this.zones = zones;
    this.eyeGain = eyeGain;
  }

  setStatus(state: CameraState, message: string | null): void {
    this.state = state;
    this.message = message;
  }

  record(sample: CameraSample): void {
    this.rawListener?.(sample);
    if (this.state === 'off') return;
    this.samples.push(sample);
    if (this.samples.length > 2_000) this.samples.shift();
  }

  get currentFocus(): number | null {
    return this.lastFocus;
  }

  drain(): CameraObservation | null {
    if (this.state !== 'active' || this.samples.length === 0) {
      this.samples = [];
      return null;
    }
    const present = this.samples.filter((s) => s.facePresent);
    const attention = present.map((s) =>
      attentionFromPose(s.yawDeg, s.pitchDeg, this.lookAwayDeg, this.zones, eyeOf(s, this.eyeGain)),
    );
    const msPerSample = 1000 / this.samplesPerSecond;
    const lookingAway =
      this.samples.length - present.length + attention.filter((a) => a < 0.3).length;

    let distraction = 0;
    let offscreen = 0;
    const areaCounts = new Map<string, number>();
    const workCounts = new Map<string, number>();
    for (const s of present) {
      if (s.yawDeg === null || s.pitchDeg === null) continue;
      const gaze = classifyGaze(s.yawDeg, s.pitchDeg, this.zones, this.lookAwayDeg, eyeOf(s, this.eyeGain));
      if (gaze.target === 'offscreen') offscreen++;
      if (gaze.target === 'screen' && gaze.zone?.displayId === null && gaze.zone.label) {
        workCounts.set(gaze.zone.label, (workCounts.get(gaze.zone.label) ?? 0) + 1);
      }
      if (gaze.target === 'distraction') {
        distraction++;
        const label = gaze.zone?.label ?? 'distraction area';
        areaCounts.set(label, (areaCounts.get(label) ?? 0) + 1);
      }
    }
    const topArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const topWork = [...workCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const workAreaLabel = topWork && topWork[1] >= present.length / 2 ? topWork[0] : null;

    const obs: CameraObservation = {
      samples: this.samples.length,
      presence: present.length / this.samples.length,
      focus: attention.length ? attention.reduce((a, b) => a + b, 0) / attention.length : 0,
      lookingAwayMs: Math.round(lookingAway * msPerSample),
      distractionRatio: present.length ? distraction / present.length : 0,
      offScreenRatio: present.length ? offscreen / present.length : 0,
      distractionLabel: topArea,
      workAreaLabel,
    };
    this.lastFocus = obs.presence * obs.focus;
    this.samples = [];
    return obs;
  }

  reset(): void {
    this.samples = [];
    this.lastFocus = null;
    this.state = 'off';
    this.message = null;
  }
}
