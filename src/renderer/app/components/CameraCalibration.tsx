import { useEffect, useRef, useState } from 'react';
import { Camera, Check, X } from 'lucide-react';
import { classifyGaze, fitEyeGain, NO_EYE_GAIN } from '@shared/focus/gaze';
import type { DisplayInfo } from '@shared/ipc/contract';
import type { EyeGain, FocusZone, GazePoint } from '@shared/types';
import { call } from '../lib/api';
import { ErrorText } from './ui';

type Phase = 'idle' | 'starting' | 'capturing' | 'paused' | 'waiting' | 'result' | 'saving';
type Mode = 'screens' | 'work' | 'distraction';
type AreaMode = Exclude<Mode, 'screens'>;

interface Spot {
  x: number;
  y: number;
}

/** Centre first, then around the edges; the top and bottom middles separate stacked screens. */
const SCREEN_POINTS: Spot[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const AREA_POINTS = ['top', 'centre', 'bottom'] as const;
const CHECKS_PER_DISPLAY = 3;

interface VerifyResult {
  expected: number;
  got: number | null;
  headOnly: number | null;
}

interface Pending {
  zones: FocusZone[];
  gain: EyeGain;
  results: VerifyResult[];
}

/** Scaled drawing of the Windows display arrangement, highlighting the display and point to look at. */
function DisplayLayout(props: { displays: DisplayInfo[]; target: number | null; point: Spot | null; done: Set<number> }) {
  const { displays } = props;
  if (displays.length === 0) return null;
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const scale = Math.min(460 / (maxX - minX), 150 / (maxY - minY));
  return (
    <div style={{ position: 'relative', width: (maxX - minX) * scale, height: (maxY - minY) * scale, margin: '0 auto' }} aria-hidden>
      {displays.map((d, i) => {
        const isTarget = props.target === d.id;
        const isDone = props.done.has(d.id);
        return (
          <div
            key={d.id}
            style={{
              position: 'absolute',
              left: (d.bounds.x - minX) * scale + 3,
              top: (d.bounds.y - minY) * scale + 3,
              width: d.bounds.width * scale - 6,
              height: d.bounds.height * scale - 6,
              border: `2px solid ${isTarget ? 'var(--ink)' : 'var(--rule-strong)'}`,
              background: isTarget ? 'var(--tint-2)' : 'var(--tint)',
              borderRadius: 4,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              color: isTarget ? 'var(--ink)' : 'var(--ink-2)',
              textAlign: 'center',
              padding: 4,
            }}
          >
            <div>
              {isDone && <Check size={14} style={{ color: 'var(--c-productive)' }} />}
              <div style={{ fontWeight: 600 }}>{i + 1}</div>
              <div className="truncate" style={{ maxWidth: d.bounds.width * scale - 16 }}>
                {d.primary ? 'Main display' : d.label}
              </div>
            </div>
            {isTarget && props.point && (
              <span
                style={{
                  position: 'absolute',
                  left: `${props.point.x * 100}%`,
                  top: `${props.point.y * 100}%`,
                  width: 8,
                  height: 8,
                  marginLeft: -4,
                  marginTop: -4,
                  borderRadius: '50%',
                  background: 'var(--c-distracted)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A named list of non-display areas with an add form, used for work and distraction areas. */
function AreaSection(props: {
  title: string;
  areas: FocusZone[];
  name: string;
  placeholder: string;
  onName: (name: string) => void;
  onAdd: () => void;
  onRemove: (zone: FocusZone) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h3>{props.title}</h3>
      {props.areas.length > 0 && (
        <div className="chip-list">
          {props.areas.map((z) => (
            <span className="chip" key={z.label}>
              {z.label}
              <button aria-label={`Remove ${z.label}`} onClick={() => props.onRemove(z)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="input"
          style={{ width: 180 }}
          value={props.name}
          onChange={(e) => props.onName(e.target.value)}
          aria-label={`${props.title} name`}
          placeholder={props.placeholder}
        />
        <button className="btn" onClick={props.onAdd} disabled={!props.name.trim()}>
          Add area
        </button>
      </div>
    </div>
  );
}

const toStored = (z: FocusZone): FocusZone => ({
  kind: z.kind,
  displayId: z.displayId,
  label: z.label,
  yawDeg: z.yawDeg,
  pitchDeg: z.pitchDeg,
  ...(z.points?.length
    ? {
        points: z.points.map(({ yawDeg, pitchDeg, eyeX, eyeY, targetX, targetY }) => ({
          yawDeg,
          pitchDeg,
          eyeX,
          eyeY,
          ...(targetX !== undefined && targetY !== undefined ? { targetX, targetY } : {}),
        })),
      }
    : {}),
});

/** A short tone, for when the user is looking away from the screen. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => void ctx.close();
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // Sound is only a cue.
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

const CANCELLED = 'cancelled';

export function CameraCalibration(props: { zones: FocusZone[]; lookAwayDeg: number; onSaved: () => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState<{ display: number | null; point: Spot | null; label: string }>({ display: null, point: null, label: '' });
  const [doneIds, setDoneIds] = useState<Set<number>>(new Set());
  const [areaIndex, setAreaIndex] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [names, setNames] = useState<Record<AreaMode, string>>({ work: 'Notepad', distraction: 'Laptop' });
  const [error, setError] = useState<string | null>(null);

  const cancelled = useRef(false);
  const resume = useRef<(() => void) | null>(null);
  const areaPoints = useRef<GazePoint[]>([]);

  useEffect(() => {
    void call('displays:list', {}).then((list) => setDisplays([...list].sort((a, b) => a.bounds.x - b.bounds.x)));
  }, []);

  const running = phase !== 'idle';

  // Release the camera if the user navigates away mid-calibration.
  useEffect(() => {
    if (!running) return;
    return () => {
      cancelled.current = true;
      resume.current?.();
      void call('calibration:stop', {});
    };
  }, [running]);

  const screens = props.zones.filter((z) => z.kind === 'screen' && z.displayId !== null);
  const workAreas = props.zones.filter((z) => z.kind === 'screen' && z.displayId === null);
  const distractions = props.zones.filter((z) => z.kind === 'distraction');
  const areaName = mode === 'work' || mode === 'distraction' ? names[mode].trim() : '';
  const nameOf = (d: DisplayInfo): string => `display ${displays.indexOf(d) + 1}${d.primary ? ' (main)' : ''}`;
  const displayName = (id: number | null): string => {
    const d = displays.find((x) => x.id === id);
    return d ? nameOf(d) : 'away';
  };
  const fail = (err: unknown): void => setError(err instanceof Error ? err.message : String(err));

  const save = async (zones: FocusZone[], eyeGain: EyeGain): Promise<void> => {
    await call('settings:update', { camera: { zones: zones.map(toStored), eyeGain } });
    props.onSaved();
  };

  const stop = async (): Promise<void> => {
    await call('calibration:stop', {});
    setPhase('idle');
    setMode(null);
    setStep({ display: null, point: null, label: '' });
  };

  /** Captures one point, pausing for a retry (Space) when the face was not seen clearly. */
  const capture = async (displayId: number | null, spot: Spot): Promise<GazePoint> => {
    for (;;) {
      try {
        const { yawDeg, pitchDeg, eyeX, eyeY } = await call('calibration:point', { displayId, ...spot });
        return { yawDeg, pitchDeg, eyeX, eyeY };
      } catch (err) {
        if (cancelled.current) throw new Error(CANCELLED);
        fail(err);
        setPhase('paused');
        await new Promise<void>((resolve) => (resume.current = resolve));
        resume.current = null;
        if (cancelled.current) throw new Error(CANCELLED);
        setError(null);
        setPhase('capturing');
      }
    }
  };

  const startCamera = async (next: Mode): Promise<boolean> => {
    cancelled.current = false;
    setError(null);
    setPending(null);
    setMode(next);
    setPhase('starting');
    try {
      await call('calibration:start', {});
      return true;
    } catch (err) {
      fail(err);
      setPhase('idle');
      setMode(null);
      return false;
    }
  };

  const runScreens = async (): Promise<void> => {
    setDoneIds(new Set());
    if (!(await startCamera('screens'))) return;
    setPhase('capturing');
    try {
      const fresh: FocusZone[] = [];
      for (const d of displays) {
        const points: GazePoint[] = [];
        for (const [i, spot] of SCREEN_POINTS.entries()) {
          setStep({ display: d.id, point: spot, label: `${nameOf(d)} · ${i + 1}/${SCREEN_POINTS.length}` });
          points.push({ ...(await capture(d.id, spot)), targetX: spot.x, targetY: spot.y });
        }
        const centre = points[0] as GazePoint;
        fresh.push({ kind: 'screen', displayId: d.id, label: nameOf(d), yawDeg: centre.yawDeg, pitchDeg: centre.pitchDeg, points });
        setDoneIds((s) => new Set([...s, d.id]));
      }
      const zones = [...fresh, ...props.zones.filter((z) => z.displayId === null)];
      const gain = fitEyeGain(zones);

      if (displays.length < 2) {
        setPhase('saving');
        await save(zones, gain);
        await stop();
        return;
      }

      // Check against fresh points, moving between displays so neighbours get mixed up if they can.
      const checks = shuffle(
        displays.flatMap((d) =>
          Array.from({ length: CHECKS_PER_DISPLAY }, () => ({ display: d, spot: { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6 } })),
        ),
      );
      const results: VerifyResult[] = [];
      for (const [i, c] of checks.entries()) {
        setStep({ display: c.display.id, point: c.spot, label: `Check ${i + 1}/${checks.length}` });
        const p = await capture(c.display.id, c.spot);
        const at = (g: EyeGain): number | null =>
          classifyGaze(p.yawDeg, p.pitchDeg, zones, props.lookAwayDeg, { eyeX: p.eyeX, eyeY: p.eyeY, gain: g }).zone?.displayId ?? null;
        results.push({ expected: c.display.id, got: at(gain), headOnly: at(NO_EYE_GAIN) });
      }
      chime();
      await call('calibration:stop', {});
      setStep({ display: null, point: null, label: '' });
      setPending({ zones, gain, results });
      setPhase('result');
    } catch (err) {
      if (!(err instanceof Error && err.message === CANCELLED)) fail(err);
      await stop();
    }
  };

  const runArea = async (next: AreaMode): Promise<void> => {
    areaPoints.current = [];
    setAreaIndex(0);
    if (await startCamera(next)) setPhase('waiting');
  };

  const captureArea = async (): Promise<void> => {
    if (mode !== 'work' && mode !== 'distraction') return;
    setError(null);
    setPhase('capturing');
    try {
      const p = await capture(null, { x: 0.5, y: 0.5 });
      chime();
      areaPoints.current = [...areaPoints.current, p];
      if (areaPoints.current.length < AREA_POINTS.length) {
        setAreaIndex(areaPoints.current.length);
        setPhase('waiting');
        return;
      }
      const kind = mode === 'work' ? 'screen' : 'distraction';
      const label = areaName || (mode === 'work' ? 'Work area' : 'Distraction area');
      const points = areaPoints.current;
      const centre = points[1] as GazePoint;
      const zone: FocusZone = { kind, displayId: null, label, yawDeg: centre.yawDeg, pitchDeg: centre.pitchDeg, points };
      const replaced = (z: FocusZone): boolean => z.kind === kind && z.displayId === null && z.label === label;
      const zones = [...props.zones.filter((z) => !replaced(z)), zone];
      setPhase('saving');
      await save(zones, fitEyeGain(zones));
      await stop();
    } catch (err) {
      if (!(err instanceof Error && err.message === CANCELLED)) fail(err);
      await stop();
    }
  };

  const cancel = async (): Promise<void> => {
    cancelled.current = true;
    resume.current?.();
    setPending(null);
    await stop();
  };

  const accept = async (): Promise<void> => {
    if (!pending) return;
    setPhase('saving');
    await save(pending.zones, pending.gain);
    setPending(null);
    await stop();
  };

  const remove = (z: FocusZone): void => {
    const zones = props.zones.filter((x) => x !== z);
    void save(zones, fitEyeGain(zones)).catch(fail);
  };

  // Space retries or captures, Escape cancels; the target window never takes the keyboard.
  const keys = useRef({ phase, cancel, captureArea });
  keys.current = { phase, cancel, captureArea };
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      const k = keys.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        void k.cancel();
      } else if (e.code === 'Space' && (k.phase === 'paused' || k.phase === 'waiting')) {
        e.preventDefault();
        if (k.phase === 'paused') resume.current?.();
        else void k.captureArea();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running]);

  const correct = pending?.results.filter((r) => r.got === r.expected).length ?? 0;
  const headOnlyCorrect = pending?.results.filter((r) => r.headOnly === r.expected).length ?? 0;
  const misses = pending?.results.filter((r) => r.got !== r.expected) ?? [];
  const usesEyes = pending ? pending.gain.x !== 0 || pending.gain.y !== 0 : false;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <DisplayLayout displays={displays} target={step.display} point={step.point} done={mode === 'screens' ? doneIds : new Set()} />

      {phase === 'result' && pending ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <p>
            <b className="num">
              {correct}/{pending.results.length}
            </b>{' '}
            checks correct
            {usesEyes && headOnlyCorrect !== correct && (
              <span className="secondary num">
                {' '}
                ({headOnlyCorrect}/{pending.results.length} without eye tracking)
              </span>
            )}
          </p>
          {misses.length > 0 && (
            <ul className="small secondary" style={{ margin: 0, paddingLeft: 18 }}>
              {misses.map((m, i) => (
                <li key={i}>
                  {displayName(m.expected)} read as {displayName(m.got)}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button className="btn primary" onClick={() => void accept().catch(fail)}>
              Save
            </button>
            <button className="btn" onClick={() => void runScreens()}>
              Redo
            </button>
            <button className="btn ghost" onClick={() => void cancel()}>
              Discard
            </button>
          </div>
        </div>
      ) : running ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="camera-on">
            <Camera size={14} aria-hidden /> {phase === 'starting' ? 'Starting camera…' : 'Camera on'}
          </span>
          {mode === 'screens' && phase !== 'starting' && phase !== 'saving' && (
            <p>
              Follow the dot <span className="secondary num">· {step.label}</span>
            </p>
          )}
          {(mode === 'work' || mode === 'distraction') && phase !== 'starting' && phase !== 'saving' && (
            <p>
              Click, then look at the <b>{AREA_POINTS[areaIndex]}</b> of <b>{areaName || 'the area'}</b> until the tone.
            </p>
          )}
          <div className="row">
            {phase === 'paused' && (
              <button className="btn primary" onClick={() => resume.current?.()}>
                Retry
              </button>
            )}
            {(mode === 'work' || mode === 'distraction') && phase !== 'paused' && (
              <button className="btn primary" disabled={phase !== 'waiting'} onClick={() => void captureArea()}>
                {phase === 'capturing' ? 'Hold still…' : `Capture ${AREA_POINTS[areaIndex]}`}
              </button>
            )}
            <button className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3>Screens</h3>
            <div className="row">
              <button className="btn primary" onClick={() => void runScreens()} disabled={displays.length === 0}>
                {screens.length ? 'Recalibrate' : 'Calibrate'}
              </button>
              <button className="btn" onClick={() => void call('calibration:check', {}).catch(fail)}>
                Check
              </button>
              {screens.length > 0 ? (
                <span className="small secondary">{screens.map((z) => z.label).join(', ')}</span>
              ) : (
                displays.length > 1 && (
                  <span className="small" style={{ color: 'var(--warning)' }}>
                    Not calibrated
                  </span>
                )
              )}
            </div>
          </div>
          <AreaSection
            title="Work areas"
            areas={workAreas}
            name={names.work}
            placeholder="e.g. Notepad"
            onName={(work) => setNames({ ...names, work })}
            onAdd={() => void runArea('work')}
            onRemove={remove}
          />
          <AreaSection
            title="Distraction areas"
            areas={distractions}
            name={names.distraction}
            placeholder="e.g. Laptop"
            onName={(distraction) => setNames({ ...names, distraction })}
            onAdd={() => void runArea('distraction')}
            onRemove={remove}
          />
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
