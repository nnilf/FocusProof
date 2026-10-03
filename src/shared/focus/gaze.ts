// Head-pose geometry shared by the main process (scoring) and the calibration check (drawing).
import type { FocusZone } from '../types';

/** Anything with a head-pose centre; zones without a kind are screens. */
export type ZoneLike = Pick<FocusZone, 'yawDeg' | 'pitchDeg'> & Partial<Pick<FocusZone, 'kind' | 'label' | 'displayId'>>;

/** Pitch differences count this much more than yaw: zones are wider than they are tall. */
export const PITCH_WEIGHT = 1.2;
/** Within this share of the look-away tolerance, attention is full. */
export const FULL_ATTENTION_SHARE = 0.4;

/** Straight ahead of the camera; used as the screen when no screen has been calibrated. */
export const DEFAULT_SCREEN: ZoneLike = { yawDeg: 0, pitchDeg: 0, kind: 'screen', label: 'Screen' };

export const isScreen = (z: ZoneLike): boolean => (z.kind ?? 'screen') === 'screen';

export function withDefaultScreen(zones: readonly ZoneLike[]): readonly ZoneLike[] {
  return zones.some(isScreen) ? zones : [DEFAULT_SCREEN, ...zones];
}

const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Head yaw/pitch from MediaPipe's 4x4 column-major facial transformation matrix. */
export function headPose(m: ArrayLike<number>): { yawDeg: number; pitchDeg: number } {
  const r20 = m[2] ?? 0;
  const r21 = m[6] ?? 0;
  const r22 = m[10] ?? 1;
  return {
    yawDeg: toDeg(Math.asin(Math.max(-1, Math.min(1, -r20)))),
    pitchDeg: toDeg(Math.atan2(r21, r22)),
  };
}

/** Angular distance from a head pose to a zone centre. Pitch is weighted slightly higher. */
export function angleTo(yawDeg: number, pitchDeg: number, z: ZoneLike): number {
  return Math.max(Math.abs(yawDeg - z.yawDeg), Math.abs(pitchDeg - z.pitchDeg) * PITCH_WEIGHT);
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
  const full = lookAwayDeg * FULL_ATTENTION_SHARE;
  if (angle <= full) return 1;
  if (angle >= lookAwayDeg) return 0;
  return 1 - (angle - full) / (lookAwayDeg - full);
}
