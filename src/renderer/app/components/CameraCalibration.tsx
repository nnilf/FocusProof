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

type Mode = 'screens' | 'work' | 'distraction';
type AreaMode = Exclude<Mode, 'screens'>;

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
});

export function CameraCalibration(props: { zones: FocusZone[]; onSaved: () => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [index, setIndex] = useState(0);
  const [captured, setCaptured] = useState<FocusZone[]>([]);
  const [names, setNames] = useState<Record<AreaMode, string>>({ work: 'Notepad', distraction: 'Laptop' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call('displays:list', {}).then((list) => setDisplays([...list].sort((a, b) => a.bounds.x - b.bounds.x)));
  }, []);

  // Release the camera if the user navigates away mid-calibration.
  useEffect(() => {
    if (phase === 'idle') return;
    return () => void call('calibration:stop', {});
  }, [phase === 'idle']); // eslint-disable-line react-hooks/exhaustive-deps

  const screens = props.zones.filter((z) => z.kind === 'screen' && z.displayId !== null);
  const workAreas = props.zones.filter((z) => z.kind === 'screen' && z.displayId === null);
  const distractions = props.zones.filter((z) => z.kind === 'distraction');
  const areaName = mode === 'work' || mode === 'distraction' ? names[mode].trim() : '';
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
      if (mode === 'work' || mode === 'distraction') {
        const kind = mode === 'work' ? 'screen' : 'distraction';
        const label = areaName || (mode === 'work' ? 'Work area' : 'Distraction area');
        const zone = await call('calibration:capture', { kind, displayId: null, label });
        const replaced = (z: FocusZone): boolean => z.kind === kind && z.displayId === null && z.label === label;
        await finish([...props.zones.filter((z) => !replaced(z)), zone]);
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
        await finish([...next, ...props.zones.filter((z) => z.displayId === null)]);
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
                  Look at the <b>centre of {areaName || 'the area'}</b> and press capture (3 s).
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
          <AreaSection
            title="Work areas"
            areas={workAreas}
            name={names.work}
            placeholder="e.g. Notepad"
            onName={(work) => setNames({ ...names, work })}
            onAdd={() => void begin('work')}
            onRemove={(z) => void save(props.zones.filter((x) => x !== z))}
          />
          <AreaSection
            title="Distraction areas"
            areas={distractions}
            name={names.distraction}
            placeholder="e.g. Laptop"
            onName={(distraction) => setNames({ ...names, distraction })}
            onAdd={() => void begin('distraction')}
            onRemove={(z) => void save(props.zones.filter((x) => x !== z))}
          />
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
