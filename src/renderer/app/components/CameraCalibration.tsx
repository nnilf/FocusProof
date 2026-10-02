import { useEffect, useState } from 'react';
import { Camera, Check } from 'lucide-react';
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

export function CameraCalibration(props: { zones: FocusZone[]; onSaved: () => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<FocusZone[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('displays:list', {}).then((list) => setDisplays([...list].sort((a, b) => a.bounds.x - b.bounds.x)));
  }, []);

  // Release the camera if the user navigates away mid-calibration.
  useEffect(() => {
    if (phase === 'idle') return;
    return () => void call('calibration:stop', {});
  }, [phase === 'idle']); // eslint-disable-line react-hooks/exhaustive-deps

  const target = displays[index] ?? null;
  const nameOf = (d: DisplayInfo): string => `display ${displays.indexOf(d) + 1}${d.primary ? ' (main)' : ''}`;

  const start = async (): Promise<void> => {
    setError(null);
    setCaptured([]);
    setIndex(0);
    setPhase('starting');
    try {
      await call('calibration:start', {});
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  };

  const capture = async (): Promise<void> => {
    if (!target) return;
    setError(null);
    setPhase('capturing');
    try {
      const zone = await call('calibration:capture', { displayId: target.id, label: nameOf(target) });
      const next = [...captured.filter((z) => z.displayId !== zone.displayId), zone];
      setCaptured(next);
      if (index + 1 < displays.length) {
        setIndex(index + 1);
        setPhase('ready');
      } else {
        setPhase('saving');
        await call('settings:update', {
          camera: { zones: next.map(({ displayId, label, yawDeg, pitchDeg }) => ({ displayId, label, yawDeg, pitchDeg })) },
        });
        await call('calibration:stop', {});
        setPhase('idle');
        props.onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready');
    }
  };

  const cancel = async (): Promise<void> => {
    await call('calibration:stop', {});
    setPhase('idle');
  };

  const clear = async (): Promise<void> => {
    await call('settings:update', { camera: { zones: [] } });
    props.onSaved();
  };

  const running = phase !== 'idle';
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p className="secondary small">Look at each screen so any of them counts as focused.</p>
      <DisplayLayout displays={displays} target={running ? (target?.id ?? null) : null} done={new Set(captured.map((z) => z.displayId))} />

      {running ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="camera-on">
            <Camera size={14} aria-hidden /> {phase === 'starting' ? 'Starting camera…' : 'Camera on'}
          </span>
          {target && phase !== 'starting' && phase !== 'saving' && (
            <p>
              {index + 1}/{displays.length}: look at the <b>centre of {nameOf(target)}</b> and press capture (3 s).
            </p>
          )}
          <div className="row">
            <button className="btn primary" disabled={phase !== 'ready'} onClick={() => void capture()}>
              {phase === 'capturing' ? 'Hold still…' : `Capture ${target ? nameOf(target) : ''}`}
            </button>
            <button className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" onClick={() => void start()} disabled={displays.length === 0}>
            {props.zones.length ? 'Recalibrate' : 'Calibrate'}
          </button>
          {props.zones.length > 0 && (
            <button className="btn" onClick={() => void clear()}>
              Clear
            </button>
          )}
        </div>
      )}
      <ErrorText error={error} />

      {props.zones.length > 0 && !running && (
        <div className="small secondary">
          Calibrated: {props.zones.map((z) => z.label).join(', ')}
        </div>
      )}
      {props.zones.length === 0 && displays.length > 1 && !running && (
        <p className="small" style={{ color: 'var(--warning)' }}>
          Not calibrated
        </p>
      )}
    </div>
  );
}
