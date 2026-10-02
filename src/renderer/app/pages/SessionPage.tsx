import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Camera } from 'lucide-react';
import type { MonitoredTargetKind, MonitoringToggles } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useLiveStore } from '../stores/liveStore';
import { Alt, Card, ErrorText, Field, Loading, PageHeader, Toggle } from '../components/ui';
import { Reasons } from '../components/IntervalInspector';
import { TargetList } from './AssignmentForm';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatScore, formatSigned } from '../lib/format';

function StartSession() {
  const location = useLocation();
  const preselect = (location.state as { assignmentId?: number } | null)?.assignmentId ?? null;
  const assignments = useApi(() => call('assignments:list', { includeArchived: false }), []);
  const settings = useApi(() => call('settings:get', {}), []);
  const info = useApi(() => call('app:info', {}), []);
  const displays = useApi(() => call('displays:list', {}), []);
  const [assignmentId, setAssignmentId] = useState<number | null>(preselect);
  const [targets, setTargets] = useState<{ path: string; kind: MonitoredTargetKind }[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringToggles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (settings.data && !monitoring) setMonitoring(settings.data.monitoring);
  }, [settings.data, monitoring]);

  useEffect(() => {
    if (!assignments.data) return;
    const id = assignmentId ?? assignments.data[0]?.id ?? null;
    if (id !== assignmentId) setAssignmentId(id);
    const a = assignments.data.find((x) => x.id === id);
    setTargets(a ? a.targets.map((t) => ({ path: t.path, kind: t.kind })) : []);
  }, [assignments.data, assignmentId]);

  if (!assignments.data || !monitoring || !info.data) return <Loading />;
  const caps = info.data.capabilities;
  const set = (k: keyof MonitoringToggles) => (v: boolean) => setMonitoring({ ...monitoring, [k]: v });

  const start = async (): Promise<void> => {
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

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <Card title="Assignment">
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label="Assignment">
            <select
              className="select"
              value={assignmentId ?? ''}
              onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No assignment</option>
              {assignments.data.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.module ? ` (${a.module})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Monitored files">
            <TargetList targets={targets} onChange={setTargets} />
          </Field>
        </div>
      </Card>
      <Card title="Monitoring">
        <Toggle
          label="Active window"
          description={caps.activeWindow ? undefined : 'Unavailable on this system'}
          checked={monitoring.activeWindow && caps.activeWindow}
          disabled={!caps.activeWindow}
          onChange={set('activeWindow')}
        />
        <Toggle label="Keyboard & mouse activity" checked={monitoring.inputActivity} onChange={set('inputActivity')} />
        <Toggle label="Screen analysis" checked={monitoring.screenAnalysis} onChange={set('screenAnalysis')} />
        <Toggle label="Document monitoring" checked={monitoring.documents} onChange={set('documents')} />
        <Toggle
          label="Webcam presence & focus"
          description={caps.cameraModel ? undefined : 'Face model missing (npm run fetch-models)'}
          checked={monitoring.webcam && caps.cameraModel}
          disabled={!caps.cameraModel}
          onChange={set('webcam')}
        />
        {monitoring.webcam && (displays.data?.length ?? 0) > 1 && settings.data?.camera.zones.length === 0 && (
          <p className="small" style={{ color: 'var(--warning)', marginTop: 8 }}>
            {displays.data?.length} displays detected: <Link to="/settings">calibrate webcam</Link>
          </p>
        )}
        <ErrorText error={error} />
        <div style={{ marginTop: 14 }}>
          <button className="btn primary large" style={{ width: '100%' }} disabled={starting} onClick={() => void start()}>
            Start session
          </button>
        </div>
      </Card>
    </div>
  );
}

function ActiveSession() {
  const status = useLiveStore((s) => s.status);
  const now = useLiveStore((s) => s.now);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  if (!status) return null;

  const end = async (): Promise<void> => {
    setEnding(true);
    try {
      await call('sessions:end', {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnding(false);
    }
  };

  const cls = status.classification;
  return (
    <div className="grid" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <Card>
        <div className="session-focus">
          <span className="secondary">{status.assignmentName ?? 'No assignment'}</span>
          <div className="session-clock" aria-label="Elapsed time">
            {formatDuration(now - status.startedAt, { seconds: true })}
          </div>
          <span className="secondary">
            <Alt /> <b className="num" style={{ color: 'var(--text)' }}>{formatDuration(status.altMs)}</b>
          </span>
          <span className="state-pill" aria-live="polite">
            <span className="dot" style={{ background: cls ? CLASS_COLOR_VAR[cls] : 'var(--surface-3)' }} />
            {cls ? CLASS_LABEL[cls] : 'Starting…'}
          </span>
          {status.camera.state !== 'off' && (
            <span className="camera-on" role="status">
              <Camera size={14} aria-hidden />
              {status.camera.state === 'active'
                ? 'Camera on'
                : status.camera.state === 'starting'
                  ? 'Starting camera…'
                  : `Camera unavailable: ${status.camera.message ?? 'unknown error'}`}
            </span>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'center', paddingBottom: 12 }}>
          <button className="btn ghost" onClick={() => setDetails((d) => !d)}>
            {details ? 'Hide details' : 'Details'}
          </button>
          <button className="btn primary large" disabled={ending} onClick={() => void end()}>
            End session
          </button>
        </div>
        <ErrorText error={error} />
      </Card>
      {details && (
        <Card>
          <dl className="kv">
            <dt>Focus score</dt>
            <dd>{formatScore(status.focusScore ?? status.combinedScore)}</dd>
            <dt>Active application</dt>
            <dd>{status.activeApp ?? '—'}</dd>
            <dt>Idle</dt>
            <dd className="num">{formatDuration(status.idleMs)}</dd>
            <dt>Document changes</dt>
            <dd>
              {status.docChangeEvents} saves · {formatSigned(status.netWords)} net words
            </dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            <Reasons reasons={status.lastReasons} />
          </div>
          {status.sourceWarnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {status.sourceWarnings.map((w) => (
                <p key={w} className="small" style={{ color: 'var(--warning)' }}>
                  {w}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function SessionPage() {
  const status = useLiveStore((s) => s.status);
  return (
    <div className="page">
      <PageHeader
        title={status ? 'Session' : 'New session'}
      />
      {status ? <ActiveSession /> : <StartSession />}
    </div>
  );
}
