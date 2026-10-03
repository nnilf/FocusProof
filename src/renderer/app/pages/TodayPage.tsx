import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Assignment } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useLiveStore } from '../stores/liveStore';
import { DayRibbon } from '../components/DayRibbon';
import { StartBar } from '../components/StartBar';
import { ALT_DEFINITION, ErrorText, Loading } from '../components/ui';
import { formatDate, formatDay, formatDuration, formatNumber, formatPct, formatTime } from '../lib/format';
import { AssignmentForm } from './AssignmentForm';

function progressText(a: Assignment): string {
  if (a.targetWordCount) return `${formatNumber(a.currentWordCount)} of ${formatNumber(a.targetWordCount)} words`;
  return a.module;
}

export function TodayPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const preselect = (location.state as { assignmentId?: number } | null)?.assignmentId ?? null;
  const now = useLiveStore((s) => s.now);
  const dash = useApi(() => call('analytics:dashboard', {}), []);
  const day = useApi(() => call('sessions:day', {}), []);
  const assignments = useApi(() => call('assignments:list', { includeArchived: true }), []);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!dash.data || !assignments.data) {
    return <div className="page">{dash.loading || assignments.loading ? <Loading /> : <ErrorText error={dash.error ?? assignments.error} />}</div>;
  }
  const d = dash.data;
  const active = assignments.data.filter((a) => a.archivedAt === null);
  const archived = assignments.data.filter((a) => a.archivedAt !== null);
  const listed = showArchived ? assignments.data : active;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const earlier = d.recent.filter((r) => r.session.startedAt >= startOfToday);

  const clearDemo = async (): Promise<void> => {
    if (!window.confirm('Remove all demo assignments and sessions? Your own data is not affected.')) return;
    await call('demo:clear', {});
  };

  return (
    <div className="page">
      <section className="section" aria-label="Today">
        <h1>{formatDay(now)}</h1>
        <div className="figure">
          <strong>{formatDuration(d.today.altMs)}</strong>
          <span className="secondary" title={ALT_DEFINITION}>
            studied
            {d.today.durationMs > 0 && `, of ${formatDuration(d.today.durationMs)} at your desk`}
          </span>
        </div>
        <DayRibbon sessions={day.data ?? []} now={now} />
      </section>

      <StartBar key={preselect ?? 'none'} assignments={active} preselect={preselect} />

      {d.hasDemoData && (
        <p className="notice">
          You're looking at demo data. <button className="text-btn" onClick={() => void clearDemo()}>Remove it</button>
        </p>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Assignments</h2>
          <button className="text-btn" onClick={() => setCreating(true)}>
            New assignment
          </button>
        </div>
        {listed.length ? (
          <div className="list">
            {listed.map((a) => (
              <Link key={a.id} to={`/assignments/${a.id}`} className="list-row">
                <span className="name truncate">
                  {a.name}
                  {a.archivedAt && <span className="muted"> (archived)</span>}
                </span>
                <span className="secondary small num">{progressText(a)}</span>
                <span className="secondary small">{a.deadline ? `due ${formatDate(a.deadline)}` : ''}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            Add what you're working on, with the files to watch.
            <button className="btn" onClick={() => setCreating(true)}>
              New assignment
            </button>
          </div>
        )}
        {archived.length > 0 && (
          <div>
            <button className="text-btn small" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          </div>
        )}
      </section>

      {earlier.length > 0 && (
        <section className="section">
          <h2>Earlier today</h2>
          <div className="list">
            {earlier.map(({ session, metrics }) => (
              <Link key={session.id} to={`/report/${session.id}`} className="list-row">
                <span className="name truncate">{session.assignmentName ?? 'Nothing specific'}</span>
                <span className="secondary small num">
                  {formatDuration(metrics?.altMs)} studied, {formatPct(metrics?.productivity)} productive
                </span>
                <span className="secondary small num">
                  {formatTime(session.startedAt)}–{formatTime(session.endedAt ?? session.lastHeartbeatAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {creating && (
        <AssignmentForm initial={null} onClose={() => setCreating(false)} onSaved={(a) => navigate(`/assignments/${a.id}`)} />
      )}
    </div>
  );
}
