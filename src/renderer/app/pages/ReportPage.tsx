import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { ErrorText, Loading } from '../components/ui';
import { ClassBreakdown } from '../components/ClassBreakdown';
import { TimelineBar, TimelineList } from '../components/Timeline';
import { IntervalInspector } from '../components/IntervalInspector';
import { basename, formatDay, formatDuration, formatPct, formatScore, formatSigned, formatTime } from '../lib/format';

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
    navigate('/progress');
  };

  return (
    <div className="page">
      <section className="section">
        <div style={{ display: 'grid', gap: 4 }}>
          <h1>{session.assignmentName ?? 'Session'}</h1>
          <p className="secondary">
            {formatDay(session.startedAt)}, {formatTime(session.startedAt)}–{formatTime(session.endedAt ?? session.lastHeartbeatAt)}
            {session.status === 'recovered' && ' (recovered after an interruption)'}
          </p>
        </div>
        <div className="facts">
          <div>
            <b>{formatDuration(m.altMs)}</b>
            <span>studied</span>
          </div>
          <div>
            <b>{formatDuration(m.durationMs)}</b>
            <span>{m.untrackedMs >= 60_000 ? `session, ${formatDuration(m.untrackedMs)} unmonitored` : 'session'}</span>
          </div>
          <div>
            <b>{formatPct(m.productivity)}</b>
            <span>productive</span>
          </div>
          <div>
            <b>{m.distractionCount}</b>
            <span>{m.distractionCount === 1 ? 'distraction' : 'distractions'}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Timeline</h2>
        <TimelineBar blocks={data.timeline} selected={selected} onSelect={setSelected} />
        <ClassBreakdown values={{ productive: m.productiveMs, neutral: m.neutralMs, distracted: m.distractedMs, away: m.awayMs }} />
        {block ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <IntervalInspector block={block} intervals={data.intervals} />
            <div>
              <button className="text-btn small" onClick={() => setSelected(null)}>
                Back to all blocks
              </button>
            </div>
          </div>
        ) : (
          <details>
            <summary>All blocks</summary>
            <div style={{ paddingTop: 8 }}>
              <TimelineList blocks={data.timeline} selected={selected} onSelect={setSelected} />
            </div>
          </details>
        )}
      </section>

      {data.insights.length > 0 && (
        <section className="section">
          <h2>Worth knowing</h2>
          <div style={{ display: 'grid', gap: 6 }}>
            {data.insights.map((i) => (
              <p key={i.id}>{i.text}</p>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="grid cols-2" style={{ gap: 32 }}>
          <div className="section">
            <h2>Writing</h2>
            {hasDocs ? (
              <dl className="kv">
                {textFiles && (
                  <>
                    <dt>Net words</dt>
                    <dd>{formatSigned(m.netWords)}</dd>
                    <dt>Added, removed</dt>
                    <dd>
                      {m.wordsAdded.toLocaleString()}, {m.wordsRemoved.toLocaleString()}
                    </dd>
                  </>
                )}
                {codeFiles && (
                  <>
                    <dt>Lines</dt>
                    <dd>
                      +{m.linesAdded} / −{m.linesRemoved}
                    </dd>
                  </>
                )}
                <dt>Files changed</dt>
                <dd>{m.filesChanged}</dd>
                <dt>Editing</dt>
                <dd>{formatDuration(m.editingMs)}</dd>
              </dl>
            ) : (
              <p className="muted">No files were watched.</p>
            )}
          </div>
          <div className="section">
            <h2>Focus</h2>
            <dl className="kv">
              <dt>Longest focused stretch</dt>
              <dd>{formatDuration(m.longestProductiveMs)}</dd>
              <dt>Typical stretch</dt>
              <dd>{formatDuration(m.avgProductiveBlockMs)}</dd>
              <dt>Distracted, away</dt>
              <dd>
                {formatDuration(m.distractedMs)}, {formatDuration(m.awayMs)}
              </dd>
              <dt>Focus score</dt>
              <dd>{m.avgFocus !== null ? formatScore(m.avgFocus) : formatScore(m.avgScore)}</dd>
            </dl>
          </div>
        </div>
      </section>

      {hasDocs && (
        <details>
          <summary>Files</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>File</th>
                <th className="right">Saves</th>
                <th className="right">Words</th>
                <th className="right">Words +/−</th>
                <th className="right">Lines +/−</th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.path}>
                  <td className="truncate" style={{ maxWidth: 260 }} title={f.path}>
                    {basename(f.path)}
                  </td>
                  <td className="right">{f.edits}</td>
                  <td className="right">{f.startWords !== null ? `${f.startWords} to ${f.endWords ?? '—'}` : '—'}</td>
                  <td className="right">{f.kind === 'code' ? '—' : `+${f.wordsAdded} / −${f.wordsRemoved}`}</td>
                  <td className="right">{f.kind === 'docx' ? '—' : `+${f.linesAdded} / −${f.linesRemoved}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div>
        <button className="text-btn danger small" onClick={() => void remove()}>
          Delete this session
        </button>
      </div>
    </div>
  );
}
