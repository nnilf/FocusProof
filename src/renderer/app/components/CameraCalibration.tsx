import { useEffect, useState } from 'react';
import { Camera, Check, X } from 'lucide-react';
import type { DisplayInfo } from '@shared/ipc/contract';
import type { FocusZone } from '@shared/types';
import { call } from '../lib/api';
import { ErrorText } from './ui';

type Phase = 'idle' | 'starting' | 'ready' | 'capturing' | 'saving';

/** Scaled drawing of the Windows display arrangement, highlighting the display to look at. */
function DisplayLayout(props: { displays: DisplayInfo[]; target: number | null; done: Set<number> }) {
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
              border: `2px solid ${isTarget ? 'var(--text)' : 'var(--border-strong)'}`,
              background: isTarget ? 'var(--surface-3)' : 'var(--surface-2)',
              borderRadius: 4,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              color: isTarget ? 'var(--text)' : 'var(--text-2)',
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
              {isTarget && <div style={{ fontSize: 18, lineHeight: 1 }}>◎</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Mode = 'screens' | 'area';

const toStored = (z: FocusZone): FocusZone => ({
  kind: z.kind,
  displayId: z.displayId,
  label: z.label,
  yawDeg: z.yawDeg,
  pitchDeg: z.pitchDeg,
});

export function CameraCalibration(props: { zones: FocusZone[]; onSaved: () => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<FocusZone[]>([]);
  const [areaName, setAreaName] = useState('Laptop');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('displays:list', {}).then((list) => setDisplays([...list].sort((a, b) => a.bounds.x - b.bounds.x)));
  }, []);

  // Release the camera if the user navigates away mid-calibration.
  useEffect(() => {
    if (phase === 'idle') return;
    return () => void call('calibration:stop', {});
  }, [phase === 'idle']); // eslint-disable-line react-hooks/exhaustive-deps

  const screens = props.zones.filter((z) => z.kind === 'screen');
  const areas = props.zones.filter((z) => z.kind === 'distraction');
  const target = mode === 'screens' ? (displays[index] ?? null) : null;
  const nameOf = (d: DisplayInfo): string => `display ${displays.indexOf(d) + 1}${d.primary ? ' (main)' : ''}`;
  const fail = (err: unknown): void => setError(err instanceof Error ? err.message : String(err));

  const save = async (zones: FocusZone[]): Promise<void> => {
    await call('settings:update', { camera: { zones: zones.map(toStored) } });
    props.onSaved();
  };

  const begin = async (next: Mode): Promise<void> => {
    setError(null);
    setCaptured([]);
    setIndex(0);
    setMode(next);
    setPhase('starting');
    try {
      await call('calibration:start', {});
      setPhase('ready');
    } catch (err) {
      fail(err);
      setPhase('idle');
      setMode(null);
    }
  };

  const finish = async (zones: FocusZone[]): Promise<void> => {
    setPhase('saving');
    await save(zones);
    await call('calibration:stop', {});
    setPhase('idle');
    setMode(null);
  };

  const capture = async (): Promise<void> => {
    setError(null);
    setPhase('capturing');
    try {
      if (mode === 'area') {
        const label = areaName.trim() || 'Distraction area';
        const zone = await call('calibration:capture', { kind: 'distraction', displayId: null, label });
        await finish([...props.zones.filter((z) => !(z.kind === 'distraction' && z.label === label)), zone]);
        return;
      }
      if (!target) return;
      const zone = await call('calibration:capture', { kind: 'screen', displayId: target.id, label: nameOf(target) });
      const next = [...captured.filter((z) => z.displayId !== zone.displayId), zone];
      setCaptured(next);
      if (index + 1 < displays.length) {
        setIndex(index + 1);
        setPhase('ready');
      } else {
        await finish([...next, ...areas]);
      }
    } catch (err) {
      fail(err);
      setPhase('ready');
    }
  };

  const cancel = async (): Promise<void> => {
    await call('calibration:stop', {});
    setPhase('idle');
    setMode(null);
  };

  const running = phase !== 'idle';
  const doneIds = new Set(captured.map((z) => z.displayId).filter((id): id is number => id !== null));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <DisplayLayout displays={displays} target={target?.id ?? null} done={doneIds} />

      {running ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="camera-on">
            <Camera size={14} aria-hidden /> {phase === 'starting' ? 'Starting camera…' : 'Camera on'}
          </span>
          {phase !== 'starting' && phase !== 'saving' && (
            <p>
              {mode === 'screens' && target ? (
                <>
                  {index + 1}/{displays.length}: look at the <b>centre of {nameOf(target)}</b> and press capture (3 s).
                </>
              ) : (
                <>
                  Look at the <b>centre of {areaName.trim() || 'the area'}</b> and press capture (3 s).
                </>
              )}
            </p>
          )}
          <div className="row">
            <button className="btn primary" disabled={phase !== 'ready'} onClick={() => void capture()}>
              {phase === 'capturing' ? 'Hold still…' : 'Capture'}
            </button>
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
              <button className="btn primary" onClick={() => void begin('screens')} disabled={displays.length === 0}>
                {screens.length ? 'Recalibrate' : 'Calibrate'}
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
          <div style={{ display: 'grid', gap: 6 }}>
            <h3>Distraction areas</h3>
            {areas.length > 0 && (
              <div className="chip-list">
                {areas.map((z) => (
                  <span className="chip" key={z.label}>
                    {z.label}
                    <button aria-label={`Remove ${z.label}`} onClick={() => void save(props.zones.filter((x) => x !== z))}>
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
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                aria-label="Area name"
                placeholder="e.g. Laptop"
              />
              <button className="btn" onClick={() => void begin('area')} disabled={!areaName.trim()}>
                Add area
              </button>
            </div>
          </div>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
