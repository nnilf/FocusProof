import {
  FULL_ATTENTION_SHARE,
  PITCH_WEIGHT,
  gazeOf,
  isScreen,
  withDefaultScreen,
  zoneBox,
  zoneHasEye,
  zonePoints,
  type ZoneLike,
} from '@shared/focus/gaze';
import type { EyeGain } from '@shared/types';

export interface Pose {
  yawDeg: number;
  pitchDeg: number;
  eyeX: number | null;
  eyeY: number | null;
}

/**
 * Gaze (head pose plus eye direction, when calibrated) plotted against the calibrated zones, as
 * seen from the user (mirrored like the video): each zone's outer box is the look-away tolerance
 * around the area its calibration points span, the inner box is where attention is full.
 */
export function GazeMap(props: {
  zones: readonly ZoneLike[];
  /** Null draws head pose only. */
  eyeGain: EyeGain | null;
  lookAwayDeg: number;
  pose: Pose | null;
  trail: Pose[];
  activeZone: ZoneLike | null;
  color: string;
  zoneColor: (zone: ZoneLike) => string;
}) {
  const zones = withDefaultScreen(props.zones);
  const L = props.lookAwayDeg;
  const Lp = L / PITCH_WEIGHT;
  // Mirror yaw so turning right moves right, as in the video.
  const px = (yaw: number): number => -yaw;
  const gainOf = (z: ZoneLike): EyeGain | null => (props.eyeGain && zoneHasEye(z) ? props.eyeGain : null);
  const boxes = zones.map((z) => zoneBox(z, gainOf(z)));
  const eyeUsed = zones.some((z) => gainOf(z) !== null);
  const at = (p: Pose): { x: number; y: number } => {
    const g = gazeOf(p, eyeUsed ? props.eyeGain : null);
    return { x: px(g.x), y: g.y };
  };

  let minX = -45;
  let maxX = 45;
  let minY = -30;
  let maxY = 30;
  for (const b of boxes) {
    minX = Math.min(minX, px(b.maxX) - L - 6);
    maxX = Math.max(maxX, px(b.minX) + L + 6);
    minY = Math.min(minY, b.minY - Lp - 8);
    maxY = Math.max(maxY, b.maxY + Lp + 4);
  }
  const clampX = (x: number): number => Math.min(maxX - 2, Math.max(minX + 2, x));
  const clampY = (y: number): number => Math.min(maxY - 2, Math.max(minY + 2, y));
  // Roughly 12px text whether the map is limited by its width or by its maximum height.
  const font = Math.max((maxX - minX) / 56, (maxY - minY) / 28);

  const grid: number[] = [];
  for (let v = -90; v <= 90; v += 15) grid.push(v);

  return (
    <svg
      className="gaze-map"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${maxX - minX} / ${maxY - minY}` }}
      role="img"
      aria-label="Head direction against calibrated zones"
    >
      {grid.map((v) => (
        <g key={v} className={v === 0 ? 'axis' : 'grid'}>
          {v > minX && v < maxX && <line x1={v} x2={v} y1={minY} y2={maxY} vectorEffect="non-scaling-stroke" />}
          {v > minY && v < maxY && <line y1={v} y2={v} x1={minX} x2={maxX} vectorEffect="non-scaling-stroke" />}
        </g>
      ))}
      <g className="camera-mark">
        <rect x={-2.2} y={-1.4} width={4.4} height={2.8} rx={0.6} />
        <circle r={0.8} />
        <text y={-2.4} fontSize={font * 0.85} textAnchor="middle">
          Camera
        </text>
      </g>

      {zones.map((z, i) => {
        const b = boxes[i] ?? zoneBox(z, null);
        // Mirrored: the box's left edge is its largest yaw.
        const left = px(b.maxX);
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        const color = props.zoneColor(z);
        const active = props.activeZone === z;
        const f = FULL_ATTENTION_SHARE;
        const points = z.points?.length ? zonePoints(z).map((p) => gazeOf(p, gainOf(z))) : [];
        return (
          <g key={`${z.label}-${i}`} className={`zone ${active ? 'active' : ''}`}>
            <rect x={left - L} y={b.minY - Lp} width={w + 2 * L} height={h + 2 * Lp} rx={2} fill={color} stroke={color} className="zone-outer" vectorEffect="non-scaling-stroke" />
            {isScreen(z) && (
              <rect x={left - L * f} y={b.minY - Lp * f} width={w + 2 * L * f} height={h + 2 * Lp * f} rx={1.2} fill={color} className="zone-inner" />
            )}
            {points.map((p, j) => (
              <circle key={j} cx={px(p.x)} cy={p.y} r={font * 0.25} fill={color} />
            ))}
            <text x={left + w / 2} y={b.minY - Lp - font * 0.5} fontSize={font} textAnchor="middle" className="zone-label">
              {z.label ?? 'Screen'}
            </text>
          </g>
        );
      })}

      {props.trail.length > 1 && (
        <polyline
          className="trail"
          points={props.trail.map((p) => `${clampX(at(p).x)},${clampY(at(p).y)}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {props.pose && (
        <g className="pose" transform={`translate(${clampX(at(props.pose).x)} ${clampY(at(props.pose).y)})`}>
          <circle r={font * 1.4} fill={props.color} className="pose-halo" />
          <circle r={font * 0.62} fill={props.color} className="pose-dot" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}
