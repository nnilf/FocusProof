import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useThemeColors } from '../lib/theme';
import { BarSeriesChart } from '../components/charts';
import { SessionTable } from '../components/SessionTable';
import { ErrorText, Loading, ProgressBar } from '../components/ui';
import { basename, formatDate, formatDayKey, formatDuration, formatNumber, formatPct, hoursTick } from '../lib/format';
import { AssignmentForm } from './AssignmentForm';

function dueText(ts: number): string {
  const days = Math.ceil((ts - Date.now()) / 86_400_000);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 0 ? `${-days} days ago` : `in ${days} days`;
  return `due ${formatDate(ts)}, ${when}`;
}

export function AssignmentPage() {
  const id = Number(useParams()['id']);
  const navigate = useNavigate();
  const colors = useThemeColors();
  const assignment = useApi(() => call('assignments:get', { id }), [id]);
  const stats = useApi(() => call('assignments:stats', { id }), [id]);
  const sessions = useApi(() => call('sessions:list', { assignmentId: id, limit: 200 }), [id]);
  const [editing, setEditing] = useState(false);

  const a = assignment.data;
  if (!a) return <div className="page">{assignment.loading ? <Loading /> : <ErrorText error={assignment.error ?? 'Assignment not found'} />}</div>;
  const s = stats.data;

  return (
    <div className="page">
      <section className="section">
        <div className="section-head" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <h1>{a.name}</h1>
            <p className="secondary">
              {[a.module, a.deadline ? dueText(a.deadline) : null, a.archivedAt ? 'archived' : null]
                .filter(Boolean)
                .join(', ')}
            </p>
          </div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn ghost" onClick={() => void call('assignments:archive', { id: a.id, archived: a.archivedAt === null })}>
              {a.archivedAt ? 'Unarchive' : 'Archive'}
            </button>
            <Link className="btn primary" to="/" state={{ assignmentId: a.id }}>
              Start session
            </Link>
          </div>
        </div>
        {a.description && <p className="secondary">{a.description}</p>}
      </section>

      <ErrorText error={stats.error} />
      {s && (
        <section className="section">
          <div className="facts">
            <div>
              <b>{formatDuration(s.totalAltMs)}</b>
              <span>studied</span>
            </div>
            <div>
              <b>{s.sessionCount}</b>
              <span>{s.sessionCount === 1 ? 'session' : 'sessions'}</span>
            </div>
            <div>
              <b>{formatPct(s.avgProductivity)}</b>
              <span>productive</span>
            </div>
            {s.minutesPer100Words !== null && (
              <div>
                <b>{Math.round(s.minutesPer100Words)} min</b>
                <span>per 100 words</span>
              </div>
            )}
            {s.estimatedRemainingHours !== null && s.estimatedRemainingHours >= 0.05 && (
              <div>
                <b>{s.estimatedRemainingHours.toFixed(1)}h</b>
                <span>left, {s.remainingBasis === 'word-rate' ? 'at your word rate' : 'from your estimate'}</span>
              </div>
            )}
          </div>
          {a.targetWordCount ? (
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <span className="secondary num">
                {formatNumber(a.currentWordCount)} of {formatNumber(a.targetWordCount)} words
              </span>
              <ProgressBar value={s.wordProgress} color="var(--c-productive)" label="Word count progress" />
            </div>
          ) : null}
        </section>
      )}

      {s && s.activity.length > 0 && (
        <section className="section">
          <h2>Study time</h2>
          <BarSeriesChart
            height={160}
            data={s.activity.map((d) => ({ date: d.date, altH: d.altMs / 3_600_000 }))}
            xKey="date"
            xFormat={formatDayKey}
            yFormat={hoursTick}
            series={[{ key: 'altH', label: 'Studied', color: colors.productive, format: (v) => `${v.toFixed(2)} h` }]}
          />
        </section>
      )}

      <section className="section">
        <h2>Watched files</h2>
        {a.targets.length ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {a.targets.map((t) => (
              <span key={t.id} className="truncate" title={t.path}>
                {basename(t.path)} <span className="muted small">{t.kind === 'folder' ? 'folder' : ''}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">
            None yet. <button className="text-btn" onClick={() => setEditing(true)}>Add files</button> so word counts are tracked.
          </p>
        )}
      </section>

      {a.notes && (
        <section className="section">
          <h2>Notes</h2>
          <p className="secondary" style={{ whiteSpace: 'pre-wrap' }}>
            {a.notes}
          </p>
        </section>
      )}

      {sessions.data && sessions.data.length > 0 && (
        <section className="section">
          <h2>Sessions</h2>
          <SessionTable rows={sessions.data} hideAssignment />
        </section>
      )}

      {editing && (
        <AssignmentForm
          initial={a}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            navigate(`/assignments/${saved.id}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}
