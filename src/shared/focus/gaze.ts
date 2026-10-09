// Head-pose and eye-direction geometry shared by the main process (scoring) and the calibration
// check (drawing).
import type { EyeGain, FocusZone, GazePoint } from '../types';

/** Anything with a head-pose centre; zones without a kind are screens. */
export type ZoneLike = Pick<FocusZone, 'yawDeg' | 'pitchDeg'> &
  Partial<Pick<FocusZone, 'kind' | 'label' | 'displayId' | 'points'>>;

/** Pitch differences count this much more than yaw: zones are wider than they are tall. */
export const PITCH_WEIGHT = 1.2;
/** Within this share of the look-away tolerance, attention is full. */
export const FULL_ATTENTION_SHARE = 0.4;
/** Degrees of gaze that a full-strength eye-direction blendshape stands for, at a gain of 1. */
export const EYE_RANGE_DEG = 30;
export const NO_EYE_GAIN: EyeGain = { x: 0, y: 0 };

/** Where the eyes point within the head, with the gain that turns it into degrees. */
export interface EyeContext {
  eyeX: number | null;
  eyeY: number | null;
  gain: EyeGain;
}

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

/**
 * Eye direction within the head from MediaPipe's face blendshapes, each roughly -1 to 1 and signed
 * like head pose: x positive towards the user's left, y positive downwards.
 */
export function eyeDirection(
  categories: readonly { categoryName: string; score: number }[] | undefined,
): { eyeX: number; eyeY: number } | null {
  if (!categories?.length) return null;
  const s = new Map(categories.map((c) => [c.categoryName, c.score]));
  const get = (name: string): number | undefined => s.get(name);
  const names = ['eyeLookOutLeft', 'eyeLookInLeft', 'eyeLookOutRight', 'eyeLookInRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight'];
  if (names.some((n) => get(n) === undefined)) return null;
  const v = (n: string): number => get(n) ?? 0;
  return {
    eyeX: (v('eyeLookOutLeft') + v('eyeLookInRight') - v('eyeLookInLeft') - v('eyeLookOutRight')) / 2,
    eyeY: (v('eyeLookDownLeft') + v('eyeLookDownRight') - v('eyeLookUpLeft') - v('eyeLookUpRight')) / 2,
  };
}

const hasEye = (e: { eyeX?: number | null; eyeY?: number | null } | null | undefined): boolean =>
  typeof e?.eyeX === 'number' && typeof e.eyeY === 'number';

/** A zone's calibration points; zones saved before multi-point calibration are their centre. */
export function zonePoints(z: ZoneLike): GazePoint[] {
  return z.points?.length ? z.points : [{ yawDeg: z.yawDeg, pitchDeg: z.pitchDeg, eyeX: null, eyeY: null }];
}

/** Whether every calibration point of the zone recorded eye direction. */
export const zoneHasEye = (z: ZoneLike): boolean => !!z.points?.length && z.points.every(hasEye);

/** Eye direction is only compared when the sample and every point of the zone have it. */
function usesEye(z: ZoneLike, eye: EyeContext | undefined): eye is EyeContext {
  if (!eye || (eye.gain.x === 0 && eye.gain.y === 0) || !hasEye(eye)) return false;
  return zoneHasEye(z);
}

/** Gaze direction in degrees: head pose, plus eye direction when it is used. */
export function gazeOf(p: { yawDeg: number; pitchDeg: number; eyeX?: number | null; eyeY?: number | null }, gain: EyeGain | null): { x: number; y: number } {
  if (!gain || !hasEye(p)) return { x: p.yawDeg, y: p.pitchDeg };
  return { x: p.yawDeg + gain.x * EYE_RANGE_DEG * (p.eyeX ?? 0), y: p.pitchDeg + gain.y * EYE_RANGE_DEG * (p.eyeY ?? 0) };
}

/** The box spanned by a zone's calibration points, in gaze degrees. */
export function zoneBox(z: ZoneLike, gain: EyeGain | null): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = zonePoints(z).map((p) => gazeOf(p, gain));
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

function distances(yawDeg: number, pitchDeg: number, z: ZoneLike, eye?: EyeContext): { edge: number; centre: number } {
  const gain = usesEye(z, eye) ? eye.gain : null;
  const s = gazeOf({ yawDeg, pitchDeg, eyeX: eye?.eyeX, eyeY: eye?.eyeY }, gain);
  const b = zoneBox(z, gain);
  const dx = Math.max(b.minX - s.x, 0, s.x - b.maxX);
  const dy = Math.max(b.minY - s.y, 0, s.y - b.maxY);
  const cx = Math.abs(s.x - (b.minX + b.maxX) / 2);
  const cy = Math.abs(s.y - (b.minY + b.maxY) / 2);
  return { edge: Math.max(dx, dy * PITCH_WEIGHT), centre: Math.max(cx, cy * PITCH_WEIGHT) };
}

/**
 * Angular distance from a gaze to a zone: 0 inside the area its calibration points span, else
 * the distance to its edge. Pitch is weighted slightly higher.
 */
export function angleTo(yawDeg: number, pitchDeg: number, z: ZoneLike, eye?: EyeContext): number {
  return distances(yawDeg, pitchDeg, z, eye).edge;
}

/** Angular distance from a gaze to the nearest screen zone. */
export function angleToNearestZone(yawDeg: number, pitchDeg: number, zones: readonly ZoneLike[], eye?: EyeContext): number {
  return Math.min(...withDefaultScreen(zones).filter(isScreen).map((z) => angleTo(yawDeg, pitchDeg, z, eye)));
}

export type GazeTarget = 'screen' | 'distraction' | 'offscreen';

/**
 * What the user is facing: the nearest calibrated zone (screen or distraction area), or
 * "offscreen" when every zone is further than the look-away tolerance. Because the nearest zone
 * wins, an area just below a monitor (e.g. a laptop) is separated from it at the midpoint; where
 * two zones overlap, the one whose centre is closer wins.
 */
export function classifyGaze(
  yawDeg: number,
  pitchDeg: number,
  zones: readonly ZoneLike[],
  lookAwayDeg: number,
  eye?: EyeContext,
): { target: GazeTarget; zone: ZoneLike | null } {
  let nearest: ZoneLike | null = null;
  let best = { edge: Infinity, centre: Infinity };
  for (const z of withDefaultScreen(zones)) {
    const d = distances(yawDeg, pitchDeg, z, eye);
    if (d.edge < best.edge || (d.edge === best.edge && d.centre < best.centre)) {
      best = d;
      nearest = z;
    }
  }
  if (!nearest || best.edge > lookAwayDeg) return { target: 'offscreen', zone: null };
  return { target: isScreen(nearest) ? 'screen' : 'distraction', zone: nearest };
}

/**
 * Attention estimate from gaze: facing any calibrated screen scores 1, turning beyond the
 * look-away angle from every screen scores 0, and facing a distraction area scores 0. This
 * approximates attention from head pose and eye direction; it is not precise gaze tracking.
 */
export function attentionFromPose(
  yawDeg: number | null,
  pitchDeg: number | null,
  lookAwayDeg: number,
  zones: readonly ZoneLike[] = [],
  eye?: EyeContext,
): number {
  if (yawDeg === null || pitchDeg === null) return 0.5;
  if (classifyGaze(yawDeg, pitchDeg, zones, lookAwayDeg, eye).target === 'distraction') return 0;
  const angle = angleToNearestZone(yawDeg, pitchDeg, zones, eye);
  const full = lookAwayDeg * FULL_ATTENTION_SHARE;
  if (angle <= full) return 1;
  if (angle >= lookAwayDeg) return 0;
  return 1 - (angle - full) / (lookAwayDeg - full);
}

/**
 * How well a gain tells the calibrated zones apart: each calibration point is left out of its own
 * zone in turn and checked against every zone (share classified correctly), plus a small bonus
 * for clear separation.
 */
function scoreGain(zones: readonly ZoneLike[], gain: EyeGain): number {
  let total = 0;
  let correct = 0;
  let separation = 0;
  zones.forEach((zone, zi) => {
    const points = zonePoints(zone);
    if (points.length < 2) return;
    points.forEach((p, pi) => {
      const ctx: EyeContext = { eyeX: p.eyeX, eyeY: p.eyeY, gain };
      const own = angleTo(p.yawDeg, p.pitchDeg, { ...zone, points: points.filter((_, j) => j !== pi) }, ctx);
      const other = Math.min(...zones.filter((_, j) => j !== zi).map((z) => angleTo(p.yawDeg, p.pitchDeg, z, ctx)));
      total++;
      if (own < other) correct++;
      separation += Math.min(Math.log((other + 2) / (own + 2)), Math.log(4));
    });
  });
  return total ? correct / total + (0.1 * separation) / total : 0;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

function correlation(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  a.forEach((v, i) => {
    const da = v - ma;
    const db = (b[i] ?? 0) - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  });
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** Below these, the calibration does not show which way the eyes turn. */
const MIN_TARGET_EYE_DIFF = 0.05;
const MIN_HEAD_EYE_CORRELATION = 0.3;

/**
 * Which way the horizontal eye blendshapes point, as a sign for the gain (MediaPipe's left/right
 * naming is not trusted). Looking at a dot on the left of a display must read further left than one
 * on the right; calibrations without dot positions fall back to the head, which turns the same way
 * as the eyes. 0 when the data does not say.
 */
export function eyeXSign(zones: readonly ZoneLike[]): -1 | 0 | 1 {
  let byTarget = 0;
  let byHead = 0;
  for (const z of zones) {
    if (!zoneHasEye(z)) continue;
    const points = zonePoints(z);
    const left = points.filter((p) => p.targetX !== undefined && p.targetX < 0.5);
    const right = points.filter((p) => p.targetX !== undefined && p.targetX > 0.5);
    if (left.length && right.length) {
      byTarget += mean(left.map((p) => p.eyeX ?? 0)) - mean(right.map((p) => p.eyeX ?? 0));
    } else if (points.length >= 3) {
      byHead += correlation(points.map((p) => p.yawDeg), points.map((p) => p.eyeX ?? 0));
    }
  }
  if (Math.abs(byTarget) >= MIN_TARGET_EYE_DIFF) return byTarget > 0 ? 1 : -1;
  if (byTarget === 0 && Math.abs(byHead) >= MIN_HEAD_EYE_CORRELATION) return byHead > 0 ? 1 : -1;
  return 0;
}

/**
 * Picks how much eye direction counts, from multi-point calibration data. Head pose alone (gain 0)
 * is kept unless eye direction separates the zones clearly better, so it can never make things worse.
 */
export function fitEyeGain(zones: readonly ZoneLike[]): EyeGain {
  const withEye = zones.filter((z) => (z.points?.length ?? 0) > 1 && zoneHasEye(z));
  if (withEye.length < 2 || zones.length < 2) return NO_EYE_GAIN;
  let best = NO_EYE_GAIN;
  let bestScore = scoreGain(zones, NO_EYE_GAIN);
  // Only the sign the calibration shows is tried horizontally: separating the zones alone can
  // favour a reversed gain, which moves the gaze against the eyes.
  const sign = eyeXSign(withEye);
  for (let step = 0; step <= (sign ? 6 : 0); step++) {
    const x = sign * step * 0.25 || 0;
    for (let y = 0; y <= 1.5; y += 0.25) {
      const score = scoreGain(zones, { x, y });
      if (score > bestScore + 0.01) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return best;
}
