import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Assignment } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, EmptyState, ErrorText, Loading, PageHeader, ProgressBar, Stat } from '../components/ui';
import { BarSeriesChart } from '../components/charts';
import { SessionTable } from '../components/SessionTable';
import { CLASS_HEX, basename, formatDate, formatDayKey, formatDuration, formatHours, formatNumber, formatPct } from '../lib/format';
import { AssignmentForm } from './AssignmentForm';

function daysUntil(ts: number): number {
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

function AssignmentDetail(props: { assignment: Assignment; onEdit: () => void }) {
  const a = props.assignment;
  const stats = useApi(() => call('assignments:stats', { id: a.id }), [a.id]);
  const sessions = useApi(() => call('sessions:list', { assignmentId: a.id, limit: 200 }), [a.id]);
  const s = stats.data;

  const archive = async (): Promise<void> => {
    await call('assignments:archive', { id: a.id, archived: a.archivedAt === null });
  };

  return (
    <div className="grid">
      <div className="spread">
        <div>
          <h2 style={{ fontSize: 18 }}>{a.name}</h2>
          <p className="secondary small">
            {[a.module, a.deadline ? `Due ${formatDate(a.deadline)} (${daysUntil(a.deadline)} days)` : null]
              .filter(Boolean)
              .join(' · ')}
            {a.archivedAt && ' · Archived'}
          </p>
        </div>
        <div className="row">
          <Link className="btn" to="/session" state={{ assignmentId: a.id }}>
            Start session
          </Link>
          <button className="btn" onClick={props.onEdit}>
            Edit
          </button>
          <button className="btn" onClick={() => void archive()}>
            {a.archivedAt ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>
      {a.description && <p className="secondary">{a.description}</p>}
      <ErrorText error={stats.error} />
      {s && (
        <>
          <div className="grid cols-4">
            <Stat label="Total ALT" value={formatHours(s.totalAltMs)} />
            <Stat label="Sessions" value={s.sessionCount} sub={`avg ALT ${formatDuration(s.avgAltPerSessionMs)}`} />
            <Stat label="Productivity" value={formatPct(s.avgProductivity)} />
            <Stat label="Per 100 words" value={s.minutesPer100Words !== null ? `${Math.round(s.minutesPer100Words)} min` : '—'} />
          </div>
          <div className="grid cols-2">
            <Card title="Words">
              {a.targetWordCount ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="spread">
                    <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>
                      {formatNumber(a.currentWordCount)} / {formatNumber(a.targetWordCount)}
                    </span>
                    <span className="secondary">{formatPct(s.wordProgress)}</span>
                  </div>
                  <ProgressBar value={s.wordProgress} color={CLASS_HEX.productive} label="Word count progress" />
                </div>
              ) : (
                <p className="muted small">No target set.</p>
              )}
            </Card>
            <Card title="Remaining (est.)">
              <div className="stat">
                <span className="stat-value num">
                  {s.estimatedRemainingHours !== null ? `${s.estimatedRemainingHours.toFixed(1)}h` : '—'}
                </span>
                {s.remainingBasis !== 'none' && (
                  <span className="stat-sub">{s.remainingBasis === 'word-rate' ? 'from your word rate' : 'from estimated hours'}</span>
                )}
              </div>
            </Card>
          </div>
          <Card title="Activity">
            {s.activity.length ? (
              <BarSeriesChart
                data={s.activity.map((d) => ({ ...d, altH: d.altMs / 3_600_000 }))}
                xKey="date"
                xFormat={formatDayKey}
                yFormat={(v) => `${v.toFixed(1)}h`}
                series={[{ key: 'altH', label: 'ALT', color: CLASS_HEX.productive, format: (v) => `${v.toFixed(2)} h` }]}
                height={180}
              />
            ) : (
              <p className="muted small">No sessions yet.</p>
            )}
          </Card>
        </>
      )}
      <div className="grid cols-2">
        <Card title="Monitored files">
          {a.targets.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {a.targets.map((t) => (
                <li key={t.id} title={t.path}>
                  {basename(t.path)} <span className="muted">({t.kind})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None.</p>
          )}
        </Card>
        <Card title="Notes">{a.notes ? <p className="secondary" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</p> : <p className="muted small">None.</p>}</Card>
      </div>
      <Card title="Sessions">
        {sessions.data?.length ? <SessionTable rows={sessions.data} /> : <p className="muted small">No sessions yet.</p>}
      </Card>
    </div>
  );
}

export function AssignmentsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);
  const { data, error, loading } = useApi(() => call('assignments:list', { includeArchived: true }), []);
  const selectedId = params['id'] ? Number(params['id']) : null;

  if (!data) return <div className="page">{loading ? <Loading /> : <ErrorText error={error} />}</div>;
  const visible = data.filter((a) => showArchived || a.archivedAt === null || a.id === selectedId);
  const selected = data.find((a) => a.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Assignments"
        actions={
          <>
            <label className="row small secondary">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
            <button className="btn primary" onClick={() => setEditing('new')}>
              New assignment
            </button>
          </>
        }
      />
      {data.length === 0 ? (
        <Card>
          <EmptyState action={<button className="btn primary" onClick={() => setEditing('new')}>Create assignment</button>}>
            No assignments yet.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 300px) 1fr', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            {visible.map((a) => (
              <button
                key={a.id}
                className={`list-item ${selected?.id === a.id ? 'selected' : ''}`}
                onClick={() => navigate(`/assignments/${a.id}`)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>
                    {a.name}
                  </div>
                  <div className="small muted truncate">
                    {a.module || 'No module'}
                    {a.archivedAt ? ' · archived' : a.deadline ? ` · due ${formatDate(a.deadline)}` : ''}
                  </div>
                </div>
                {a.targetWordCount ? (
                  <span className="small secondary num">{formatPct(a.currentWordCount / a.targetWordCount)}</span>
                ) : null}
              </button>
            ))}
          </div>
          {selected && <AssignmentDetail key={selected.id} assignment={selected} onEdit={() => setEditing(selected)} />}
        </div>
      )}
      {editing && (
        <AssignmentForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            navigate(`/assignments/${a.id}`);
          }}
        />
      )}
    </div>
  );
}
