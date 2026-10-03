import { useState } from 'react';
import { Camera } from 'lucide-react';
import { call } from '../lib/api';
import { useLiveStore } from '../stores/liveStore';
import { ALT_DEFINITION, ErrorText } from '../components/ui';
import { Reasons } from '../components/IntervalInspector';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatScore, formatSigned } from '../lib/format';

/** The running session fills the window. The top edge carries the current state colour. */
export function LiveSession() {
  const status = useLiveStore((s) => s.status);
  const now = useLiveStore((s) => s.now);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="live">
      <div className="live-edge" style={{ background: cls ? CLASS_COLOR_VAR[cls] : 'var(--rule)' }} aria-hidden />
      <div className="live-body">
        <span className="secondary">{status.assignmentName ?? 'Nothing specific'}</span>
        <div className="live-clock" aria-label="Elapsed time">
          {formatDuration(now - status.startedAt, { seconds: true })}
        </div>
        <p className="secondary num" aria-live="polite">
          <span title={ALT_DEFINITION}>{formatDuration(status.altMs)} studied so far</span>
          {cls ? `, ${CLASS_LABEL[cls].toLowerCase()} right now` : ''}
        </p>
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
        <div style={{ marginTop: 18 }}>
          <button className="btn primary large" disabled={ending} onClick={() => void end()}>
            End session
          </button>
        </div>
        <ErrorText error={error} />
        <details className="live-details">
          <summary>Details</summary>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Focus score</dt>
            <dd>{formatScore(status.focusScore ?? status.combinedScore)}</dd>
            <dt>Active app</dt>
            <dd>{status.activeApp ?? '—'}</dd>
            <dt>Idle</dt>
            <dd>{formatDuration(status.idleMs)}</dd>
            <dt>File changes</dt>
            <dd>
              {status.docChangeEvents} saves, {formatSigned(status.netWords)} words
            </dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            <Reasons reasons={status.lastReasons} />
          </div>
          {status.sourceWarnings.map((w) => (
            <p key={w} className="small" style={{ color: 'var(--warning)', marginTop: 8 }}>
              {w}
            </p>
          ))}
        </details>
      </div>
    </div>
  );
}
