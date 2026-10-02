import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, ErrorText, Loading, PageHeader, Stat } from '../components/ui';
import { ClassBreakdown } from '../components/ClassBreakdown';
import { TimelineBar, TimelineList } from '../components/Timeline';
import { IntervalInspector } from '../components/IntervalInspector';
import { basename, formatDateLong, formatDuration, formatPct, formatScore, formatSigned, formatTime } from '../lib/format';

export function ReportPage() {
  const id = Number(useParams()['id']);
  const navigate = useNavigate();
  const { data, error, loading } = useApi(() => call('sessions:report', { id }), [id]);
  const [selected, setSelected] = useState<number | null>(null);

  if (!data) {
    return <div className="page">{loading ? <Loading /> : <ErrorText error={error ?? 'Session not found'} />}</div>;
  }
  const { session, metrics: m } = data;
  const block = selected !== null ? data.timeline[selected] : undefined;
  const hasDocs = data.files.length > 0;
  const textFiles = data.files.some((f) => f.kind === 'text' || f.kind === 'docx');
  const codeFiles = data.files.some((f) => f.kind === 'code');

  const remove = async (): Promise<void> => {
    if (!window.confirm('Delete this session and its report permanently?')) return;
    await call('sessions:delete', { id });
    navigate('/history');
  };

  return (
    <div className="page">
      <PageHeader
        title={session.assignmentName ?? 'Session report'}
        sub={`${formatDateLong(session.startedAt)} · ${formatTime(session.startedAt)}–${formatTime(session.endedAt ?? session.lastHeartbeatAt)}${
          session.status === 'recovered' ? ' · recovered' : ''
        }`}
        actions={
          <button className="btn ghost" onClick={() => void remove()}>
            Delete
          </button>
        }
      />

      <div className="grid cols-4">
        <Stat label="Duration" value={formatDuration(m.durationMs)} sub={m.untrackedMs >= 60_000 ? `${formatDuration(m.untrackedMs)} unmonitored` : undefined} />
        <Stat label="ALT" value={formatDuration(m.altMs)} />
        <Stat label="Productivity" value={formatPct(m.productivity)} />
        <Stat label="Distracted / away" value={`${formatDuration(m.distractedMs)} / ${formatDuration(m.awayMs)}`} />
      </div>

      <Card title="Timeline">
        <div style={{ display: 'grid', gap: 16 }}>
          <TimelineBar blocks={data.timeline} selected={selected} onSelect={setSelected} />
          <ClassBreakdown values={{ productive: m.productiveMs, neutral: m.neutralMs, distracted: m.distractedMs, away: m.awayMs }} />
          {block ? (
            <IntervalInspector block={block} intervals={data.intervals} />
          ) : (
            <TimelineList blocks={data.timeline} selected={selected} onSelect={setSelected} />
          )}
          {block && (
            <div>
              <button className="btn sm" onClick={() => setSelected(null)}>
                Back to block list
              </button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid cols-3">
        <Card title="Progress">
          {hasDocs ? (
            <dl className="kv">
              {textFiles && (
                <>
                  <dt>Words added</dt>
                  <dd className="num">{m.wordsAdded.toLocaleString()}</dd>
                  <dt>Words removed</dt>
                  <dd className="num">{m.wordsRemoved.toLocaleString()}</dd>
                  <dt>Net words</dt>
                  <dd className="num">{formatSigned(m.netWords)}</dd>
                </>
              )}
              {codeFiles && (
                <>
                  <dt>Lines added / removed</dt>
                  <dd className="num">
                    +{m.linesAdded} / −{m.linesRemoved}
                  </dd>
                </>
              )}
              <dt>Files modified</dt>
              <dd className="num">{m.filesChanged}</dd>
              <dt>Active editing</dt>
              <dd className="num">{formatDuration(m.editingMs)}</dd>
            </dl>
          ) : (
            <p className="muted small">No files monitored.</p>
          )}
        </Card>
        <Card title="Focus">
          <dl className="kv">
            <dt>Average focus</dt>
            <dd className="num">{m.avgFocus !== null ? formatScore(m.avgFocus) : '—'}</dd>
            <dt>Average score</dt>
            <dd className="num">{formatScore(m.avgScore)}</dd>
            <dt>Longest productive period</dt>
            <dd className="num">{formatDuration(m.longestProductiveMs)}</dd>
            <dt>Average productive block</dt>
            <dd className="num">{formatDuration(m.avgProductiveBlockMs)}</dd>
            <dt>Distraction periods</dt>
            <dd className="num">{m.distractionCount}</dd>
          </dl>
        </Card>
        <Card title="Insights">
          {data.insights.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }} className="secondary">
              {data.insights.map((i) => (
                <li key={i.id}>{i.text}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">—</p>
          )}
        </Card>
      </div>

      {hasDocs && (
        <Card title="Files">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th className="right">Saves</th>
                <th className="right">Words start → end</th>
                <th className="right">Words +/−</th>
                <th className="right">Lines +/−</th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.path}>
                  <td title={f.path}>{basename(f.path)}</td>
                  <td className="right">{f.edits}</td>
                  <td className="right">{f.startWords !== null ? `${f.startWords} → ${f.endWords ?? '—'}` : '—'}</td>
                  <td className="right">{f.kind === 'code' ? '—' : `+${f.wordsAdded} / −${f.wordsRemoved}`}</td>
                  <td className="right">{f.kind === 'docx' ? '—' : `+${f.linesAdded} / −${f.linesRemoved}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
