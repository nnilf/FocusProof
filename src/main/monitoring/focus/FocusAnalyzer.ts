import type { CameraObservation, CameraState, FocusZone } from '@shared/types';

export interface CameraSample {
  ts: number;
  facePresent: boolean;
  yawDeg: number | null;
  pitchDeg: number | null;
}

/** Straight ahead of the camera; used when no calibration exists. */
const DEFAULT_ZONES: readonly Pick<FocusZone, 'yawDeg' | 'pitchDeg'>[] = [{ yawDeg: 0, pitchDeg: 0 }];

/** Angular distance from a head pose to the nearest screen zone. Pitch is weighted slightly higher. */
export function angleToNearestZone(
  yawDeg: number,
  pitchDeg: number,
  zones: readonly Pick<FocusZone, 'yawDeg' | 'pitchDeg'>[],
): number {
  const list = zones.length ? zones : DEFAULT_ZONES;
  return Math.min(...list.map((z) => Math.max(Math.abs(yawDeg - z.yawDeg), Math.abs(pitchDeg - z.pitchDeg) * 1.2)));
}

/**
 * Attention estimate from head pose: facing any calibrated screen scores 1, turning beyond the
 * look-away angle from every screen scores 0. This approximates attention; it is not gaze tracking.
 */
export function attentionFromPose(
  yawDeg: number | null,
  pitchDeg: number | null,
  lookAwayDeg: number,
  zones: readonly Pick<FocusZone, 'yawDeg' | 'pitchDeg'>[] = [],
): number {
  if (yawDeg === null || pitchDeg === null) return 0.5;
  const angle = angleToNearestZone(yawDeg, pitchDeg, zones);
  const full = lookAwayDeg * 0.4;
  if (angle <= full) return 1;
  if (angle >= lookAwayDeg) return 0;
  return 1 - (angle - full) / (lookAwayDeg - full);
}

/** Aggregates derived webcam samples (never images) into per-interval presence and focus. */
export class FocusAnalyzer {
  private samples: CameraSample[] = [];
  state: CameraState = 'off';
  message: string | null = null;
  private lastFocus: number | null = null;
  private zones: FocusZone[] = [];
  /** Extra raw-sample consumer (used by calibration). */
  rawListener: ((sample: CameraSample) => void) | null = null;

  constructor(
    private lookAwayDeg: number,
    private samplesPerSecond: number,
  ) {}

  configure(lookAwayDeg: number, samplesPerSecond: number, zones: FocusZone[]): void {
    this.lookAwayDeg = lookAwayDeg;
    this.samplesPerSecond = samplesPerSecond;
    this.zones = zones;
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
    const attention = present.map((s) => attentionFromPose(s.yawDeg, s.pitchDeg, this.lookAwayDeg, this.zones));
    const msPerSample = 1000 / this.samplesPerSecond;
    const lookingAway =
      this.samples.length - present.length + attention.filter((a) => a < 0.3).length;
    const obs: CameraObservation = {
      samples: this.samples.length,
      presence: present.length / this.samples.length,
      focus: attention.length ? attention.reduce((a, b) => a + b, 0) / attention.length : 0,
      lookingAwayMs: Math.round(lookingAway * msPerSample),
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
