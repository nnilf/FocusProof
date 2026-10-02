import type { CameraObservation, CameraState, FocusZone } from '@shared/types';

export interface CameraSample {
  ts: number;
  facePresent: boolean;
  yawDeg: number | null;
  pitchDeg: number | null;
}

/** Anything with a head-pose centre; zones without a kind are screens. */
export type ZoneLike = Pick<FocusZone, 'yawDeg' | 'pitchDeg'> & Partial<Pick<FocusZone, 'kind' | 'label' | 'displayId'>>;

/** Straight ahead of the camera; used as the screen when no screen has been calibrated. */
const DEFAULT_SCREEN: ZoneLike = { yawDeg: 0, pitchDeg: 0, kind: 'screen', label: 'Screen' };

const isScreen = (z: ZoneLike): boolean => (z.kind ?? 'screen') === 'screen';

function withDefaultScreen(zones: readonly ZoneLike[]): readonly ZoneLike[] {
  return zones.some(isScreen) ? zones : [DEFAULT_SCREEN, ...zones];
}

/** Angular distance from a head pose to a zone centre. Pitch is weighted slightly higher. */
function angleTo(yawDeg: number, pitchDeg: number, z: ZoneLike): number {
  return Math.max(Math.abs(yawDeg - z.yawDeg), Math.abs(pitchDeg - z.pitchDeg) * 1.2);
}

/** Angular distance from a head pose to the nearest screen zone. */
export function angleToNearestZone(yawDeg: number, pitchDeg: number, zones: readonly ZoneLike[]): number {
  return Math.min(...withDefaultScreen(zones).filter(isScreen).map((z) => angleTo(yawDeg, pitchDeg, z)));
}

export type GazeTarget = 'screen' | 'distraction' | 'offscreen';

/**
 * What the user is facing: the nearest calibrated zone (screen or distraction area), or
 * "offscreen" when every zone is further than the look-away tolerance. Because the nearest zone
 * wins, an area just below a monitor (e.g. a laptop) is separated from it at the midpoint.
 */
export function classifyGaze(
  yawDeg: number,
  pitchDeg: number,
  zones: readonly ZoneLike[],
  lookAwayDeg: number,
): { target: GazeTarget; zone: ZoneLike | null } {
  let nearest: ZoneLike | null = null;
  let best = Infinity;
  for (const z of withDefaultScreen(zones)) {
    const d = angleTo(yawDeg, pitchDeg, z);
    if (d < best) {
      best = d;
      nearest = z;
    }
  }
  if (!nearest || best > lookAwayDeg) return { target: 'offscreen', zone: null };
  return { target: isScreen(nearest) ? 'screen' : 'distraction', zone: nearest };
}

/**
 * Attention estimate from head pose: facing any calibrated screen scores 1, turning beyond the
 * look-away angle from every screen scores 0, and facing a distraction area scores 0. This
 * approximates attention; it is not gaze tracking.
 */
export function attentionFromPose(
  yawDeg: number | null,
  pitchDeg: number | null,
  lookAwayDeg: number,
  zones: readonly ZoneLike[] = [],
): number {
  if (yawDeg === null || pitchDeg === null) return 0.5;
  if (classifyGaze(yawDeg, pitchDeg, zones, lookAwayDeg).target === 'distraction') return 0;
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

    let distraction = 0;
    let offscreen = 0;
    const areaCounts = new Map<string, number>();
    const workCounts = new Map<string, number>();
    for (const s of present) {
      if (s.yawDeg === null || s.pitchDeg === null) continue;
      const gaze = classifyGaze(s.yawDeg, s.pitchDeg, this.zones, this.lookAwayDeg);
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
