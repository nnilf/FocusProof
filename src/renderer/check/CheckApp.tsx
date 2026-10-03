import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { attentionFromPose, classifyGaze, type ZoneLike } from '@shared/focus/gaze';
import type { CheckBridge, CheckConfig, CheckUpdate } from '@shared/ipc/check';
import { useThemeColors } from '../app/lib/theme';
import { formatPct } from '../app/lib/format';
import { CameraStage } from './CameraStage';
import { DecisionPanel } from './DecisionPanel';
import { GazeMap, type Pose } from './GazeMap';
import { startTracker, type Track } from './faceTracker';

declare global {
  interface Window {
    focusproofCheck: CheckBridge;
  }
}

const bridge = window.focusproofCheck;

// Updates arrive before React mounts, so they are kept outside it.
let latest: CheckUpdate | null = null;
const listeners = new Set<() => void>();
bridge.onUpdate((u) => {
  latest = u;
  listeners.forEach((l) => l());
});
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const FALLBACK: CheckConfig = {
  zones: [],
  lookAwayDeg: 30,
  samplesPerSecond: 2,
  offScreenPolicy: 'neutral',
  productiveThreshold: 0.6,
  neutralThreshold: 0.35,
};
const SMOOTHING = 0.35;
const VIEW_MS = 80;
const TRAIL = 24;

function direction(pose: Pose): string {
  const yaw = Math.round(Math.abs(pose.yawDeg));
  const pitch = Math.round(Math.abs(pose.pitchDeg));
  const h = yaw === 0 ? 'centre' : `${yaw}° ${pose.yawDeg < 0 ? 'right' : 'left'}`;
  const v = pitch === 0 ? 'level' : `${pitch}° ${pose.pitchDeg > 0 ? 'down' : 'up'}`;
  return `${h} · ${v}`;
}

export function CheckApp() {
  const update = useSyncExternalStore(subscribe, () => latest);
  const config = update?.config ?? FALLBACK;
  const configRef = useRef(config);
  configRef.current = config;
  const colors = useThemeColors();

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<{ face: boolean; pose: Pose | null; trail: Pose[] }>({ face: false, pose: null, trail: [] });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    let smooth: Pose | null = null;
    let trail: Pose[] = [];
    let lastView = 0;
    startTracker(bridge, video, () => configRef.current.samplesPerSecond, (track) => {
      if (track.yawDeg !== null && track.pitchDeg !== null) {
        smooth = smooth
          ? {
              yawDeg: smooth.yawDeg + SMOOTHING * (track.yawDeg - smooth.yawDeg),
              pitchDeg: smooth.pitchDeg + SMOOTHING * (track.pitchDeg - smooth.pitchDeg),
            }
          : { yawDeg: track.yawDeg, pitchDeg: track.pitchDeg };
      } else smooth = null;
      trackRef.current = { ...track, yawDeg: smooth?.yawDeg ?? null, pitchDeg: smooth?.pitchDeg ?? null };
      if (track.ts - lastView < VIEW_MS) return;
      lastView = track.ts;
      trail = smooth ? [...trail, smooth].slice(-TRAIL) : [];
      setView({ face: track.landmarks !== null, pose: smooth, trail });
    })
      .then((s) => {
        if (cancelled) s();
        else {
          stop = s;
          setReady(true);
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const offScreenColor = { ignore: colors.away, neutral: colors.neutral, distracted: colors.distracted }[config.offScreenPolicy];
  const zoneColor = (z: ZoneLike): string => ((z.kind ?? 'screen') === 'screen' ? colors.productive : colors.distracted);
  const gaze = view.pose ? classifyGaze(view.pose.yawDeg, view.pose.pitchDeg, config.zones, config.lookAwayDeg) : null;
  const attention = view.pose ? attentionFromPose(view.pose.yawDeg, view.pose.pitchDeg, config.lookAwayDeg, config.zones) : null;
  const color = !gaze ? colors.away : gaze.zone ? zoneColor(gaze.zone) : offScreenColor;
  const target = !view.face
    ? 'No face detected'
    : !gaze
      ? 'Finding head direction…'
      : gaze.zone
        ? `Facing ${gaze.zone.label ?? 'screen'}`
        : 'Away from all screens';

  return (
    <div className="check">
      <header className="check-head">
        <h2>Calibration check</h2>
      </header>
      <div className="check-body">
        <div className="check-camera">
          <CameraStage videoRef={videoRef} trackRef={trackRef} color={color}>
            {error ? (
              <div className="stage-empty">{error}</div>
            ) : !ready ? (
              <div className="stage-empty">Starting camera…</div>
            ) : (
              <>
                <div className="stage-chip" aria-live="polite">
                  <span className="dot" style={{ background: color }} />
                  {target}
                </div>
                {view.pose && (
                  <div className="stage-readout num">
                    <span>{direction(view.pose)}</span>
                    <span>Attention {formatPct(attention)}</span>
                  </div>
                )}
              </>
            )}
          </CameraStage>
          <GazeMap
            zones={config.zones}
            lookAwayDeg={config.lookAwayDeg}
            pose={view.pose}
            trail={view.trail}
            activeZone={gaze?.zone ?? null}
            color={color}
            zoneColor={zoneColor}
          />
        </div>
        <DecisionPanel update={update} />
      </div>
    </div>
  );
}
