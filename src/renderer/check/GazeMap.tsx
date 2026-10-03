import { FULL_ATTENTION_SHARE, PITCH_WEIGHT, isScreen, withDefaultScreen, type ZoneLike } from '@shared/focus/gaze';

export interface Pose {
  yawDeg: number;
  pitchDeg: number;
}

/**
 * Head pose plotted against the calibrated zones, as seen from the user (mirrored like the video):
 * each zone's outer box is the look-away tolerance, the inner box is where attention is full.
 */
export function GazeMap(props: {
  zones: readonly ZoneLike[];
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

  let minX = -45;
  let maxX = 45;
  let minY = -30;
  let maxY = 30;
  for (const z of zones) {
    minX = Math.min(minX, px(z.yawDeg) - L - 6);
    maxX = Math.max(maxX, px(z.yawDeg) + L + 6);
    minY = Math.min(minY, z.pitchDeg - Lp - 8);
    maxY = Math.max(maxY, z.pitchDeg + Lp + 4);
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
        const cx = px(z.yawDeg);
        const cy = z.pitchDeg;
        const color = props.zoneColor(z);
        const active = props.activeZone === z;
        const f = FULL_ATTENTION_SHARE;
        return (
          <g key={`${z.label}-${i}`} className={`zone ${active ? 'active' : ''}`}>
            <rect x={cx - L} y={cy - Lp} width={2 * L} height={2 * Lp} rx={2} fill={color} stroke={color} className="zone-outer" vectorEffect="non-scaling-stroke" />
            {isScreen(z) && (
              <rect x={cx - L * f} y={cy - Lp * f} width={2 * L * f} height={2 * Lp * f} rx={1.2} fill={color} className="zone-inner" />
            )}
            <text x={cx} y={cy - Lp - font * 0.5} fontSize={font} textAnchor="middle" className="zone-label">
              {z.label ?? 'Screen'}
            </text>
          </g>
        );
      })}

      {props.trail.length > 1 && (
        <polyline
          className="trail"
          points={props.trail.map((p) => `${clampX(px(p.yawDeg))},${clampY(p.pitchDeg)}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {props.pose && (
        <g className="pose" transform={`translate(${clampX(px(props.pose.yawDeg))} ${clampY(props.pose.pitchDeg)})`}>
          <circle r={font * 1.4} fill={props.color} className="pose-halo" />
          <circle r={font * 0.62} fill={props.color} className="pose-dot" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}
