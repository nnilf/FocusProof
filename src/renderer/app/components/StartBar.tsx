import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Assignment, MonitoredTargetKind, MonitoringToggles } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { basename } from '../lib/format';
import { TargetList } from '../pages/AssignmentForm';
import { ErrorText, Toggle } from './ui';

type Target = { path: string; kind: MonitoredTargetKind };

function assignmentInput(a: Assignment) {
  const { name, module, description, deadline, targetWordCount, currentWordCount, estimatedHours, notes } = a;
  return { name, module, description, deadline, targetWordCount, currentWordCount, estimatedHours, notes };
}

/** Pick what to work on and start. Monitored files and per-session monitoring sit behind disclosures. */
export function StartBar(props: { assignments: Assignment[]; preselect?: number | null }) {
  const { assignments } = props;
  const settings = useApi(() => call('settings:get', {}), []);
  const info = useApi(() => call('app:info', {}), []);
  const displays = useApi(() => call('displays:list', {}), []);
  const [assignmentId, setAssignmentId] = useState<number | null>(props.preselect ?? assignments[0]?.id ?? null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringToggles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (settings.data && !monitoring) setMonitoring(settings.data.monitoring);
  }, [settings.data, monitoring]);

  // Load the assignment's files only when the selection changes, not on every data reload.
  const loadedFor = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (loadedFor.current === assignmentId) return;
    loadedFor.current = assignmentId;
    const a = assignments.find((x) => x.id === assignmentId);
    setTargets(a ? a.targets.map((t) => ({ path: t.path, kind: t.kind })) : []);
  }, [assignments, assignmentId]);

  // Save file changes to the assignment so they're still there next time.
  const changeTargets = (next: Target[]): void => {
    setTargets(next);
    const a = assignments.find((x) => x.id === assignmentId);
    if (a) void call('assignments:update', { id: a.id, input: { ...assignmentInput(a), targets: next } }).catch(() => {});
  };

  const start = async (): Promise<void> => {
    if (!monitoring) return;
    setStarting(true);
    setError(null);
    try {
      await call('sessions:start', { assignmentId, targets, monitoring });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const caps = info.data?.capabilities;
  const set = (k: keyof MonitoringToggles) => (v: boolean) => monitoring && setMonitoring({ ...monitoring, [k]: v });
  const needsCalibration =
    monitoring?.webcam && (displays.data?.length ?? 0) > 1 && settings.data?.camera.zones.length === 0;

  return (
    <section className="startbar" aria-label="Start a session">
      <div className="startbar-main">
        <label htmlFor="start-assignment">Work on</label>
        <select
          id="start-assignment"
          className="select"
          value={assignmentId ?? ''}
          onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Nothing specific</option>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="btn primary large" disabled={starting || !monitoring} onClick={() => void start()}>
          Start
        </button>
      </div>
      <div className="row small" style={{ gap: 24, alignItems: 'flex-start' }}>
        <details style={{ flex: 1, minWidth: 0 }}>
          <summary className="truncate">
            {targets.length ? targets.map((t) => basename(t.path)).join(', ') : 'No files watched'}
          </summary>
          <div style={{ paddingTop: 10 }}>
            <TargetList targets={targets} onChange={changeTargets} />
          </div>
        </details>
        <details>
          <summary>Monitoring</summary>
          {monitoring && caps && (
            <div style={{ paddingTop: 6, minWidth: 280 }}>
              <Toggle
                label="Active window"
                description={caps.activeWindow ? undefined : 'Unavailable on this system'}
                checked={monitoring.activeWindow && caps.activeWindow}
                disabled={!caps.activeWindow}
                onChange={set('activeWindow')}
              />
              <Toggle label="Keyboard and mouse" checked={monitoring.inputActivity} onChange={set('inputActivity')} />
              <Toggle label="Screen changes" checked={monitoring.screenAnalysis} onChange={set('screenAnalysis')} />
              <Toggle label="Watched files" checked={monitoring.documents} onChange={set('documents')} />
              <Toggle
                label="Webcam"
                description={caps.cameraModel ? undefined : 'Run npm run fetch-models to enable'}
                checked={monitoring.webcam && caps.cameraModel}
                disabled={!caps.cameraModel}
                onChange={set('webcam')}
              />
            </div>
          )}
        </details>
      </div>
      {needsCalibration && (
        <p className="small" style={{ color: 'var(--warning)' }}>
          {displays.data?.length} screens found. <Link to="/settings#webcam">Calibrate the webcam</Link> so looking at either one counts.
        </p>
      )}
      <ErrorText error={error} />
    </section>
  );
}
