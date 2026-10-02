import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionSummaryRow } from '@shared/types';
import { Alt } from './ui';
import { formatDate, formatDuration, formatPct, formatScore, formatSigned, formatTime } from '../lib/format';

type SortKey = 'date' | 'duration' | 'alt' | 'productivity';

const value = (r: SessionSummaryRow, key: SortKey): number => {
  switch (key) {
    case 'date':
      return r.session.startedAt;
    case 'duration':
      return r.metrics?.durationMs ?? 0;
    case 'alt':
      return r.metrics?.altMs ?? 0;
    case 'productivity':
      return r.metrics?.productivity ?? 0;
  }
};

export function SessionTable(props: { rows: SessionSummaryRow[]; compact?: boolean }) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const rows = useMemo(
    () => [...props.rows].sort((a, b) => (value(a, sort.key) - value(b, sort.key)) * sort.dir),
    [props.rows, sort],
  );
  const header = (key: SortKey, label: React.ReactNode, right = false) => (
    <th
      className={`sortable ${right ? 'right' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            {header('date', 'Date')}
            <th>Assignment</th>
            {header('duration', 'Duration', true)}
            {header('alt', <Alt />, true)}
            {header('productivity', 'Productivity', true)}
            {!props.compact && <th className="right">Focus</th>}
            {!props.compact && <th className="right">Progress</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ session, metrics }) => (
            <tr key={session.id} className="clickable" onClick={() => navigate(`/report/${session.id}`)}>
              <td>
                {formatDate(session.startedAt)} <span className="muted">{formatTime(session.startedAt)}</span>
                {session.status === 'recovered' && <span className="chip" style={{ marginLeft: 6 }}>recovered</span>}
              </td>
              <td className="truncate" style={{ maxWidth: 260 }}>
                {session.assignmentName ?? <span className="muted">No assignment</span>}
              </td>
              <td className="right">{formatDuration(metrics?.durationMs)}</td>
              <td className="right">{formatDuration(metrics?.altMs)}</td>
              <td className="right">{formatPct(metrics?.productivity)}</td>
              {!props.compact && <td className="right">{formatScore(metrics?.avgFocus ?? metrics?.avgScore)}</td>}
              {!props.compact && (
                <td className="right secondary">
                  {metrics
                    ? metrics.netWords !== 0
                      ? `${formatSigned(metrics.netWords)} words`
                      : metrics.linesAdded + metrics.linesRemoved > 0
                        ? `+${metrics.linesAdded}/−${metrics.linesRemoved} lines`
                        : '—'
                    : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
