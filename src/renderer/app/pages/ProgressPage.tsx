import { useState } from 'react';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useThemeColors } from '../lib/theme';
import { BarSeriesChart } from '../components/charts';
import { ClassBreakdown } from '../components/ClassBreakdown';
import { SessionTable } from '../components/SessionTable';
import { ErrorText, Loading } from '../components/ui';
import { formatDayKey, formatDuration, formatPct, hoursTick } from '../lib/format';

const RANGES = [7, 30, 90];
const h = (ms: number): number => ms / 3_600_000;

export function ProgressPage() {
  const colors = useThemeColors();
  const [rangeDays, setRangeDays] = useState(7);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const assignments = useApi(() => call('assignments:list', { includeArchived: true }), []);
  const { data, error, loading } = useApi(() => call('analytics:query', { rangeDays, assignmentId }), [rangeDays, assignmentId]);
  const sessions = useApi(() => call('sessions:list', { assignmentId, limit: 1000 }), [assignmentId]);

  const since = new Date().setHours(0, 0, 0, 0) - (rangeDays - 1) * 86_400_000;
  const rows = sessions.data?.filter((r) => r.session.startedAt >= since) ?? [];
  const sum = (k: 'productiveMs' | 'neutralMs' | 'distractedMs' | 'awayMs'): number => data?.days.reduce((n, d) => n + d[k], 0) ?? 0;
  const peak = Math.max(1, ...(data?.hourOfDay.map((x) => x.productiveMs) ?? []));

  return (
    <div className="page">
      <section className="section">
        <div className="section-head" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <h1>Progress</h1>
          <div className="row">
            <div className="segmented" role="tablist" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r} role="tab" aria-selected={rangeDays === r} className={rangeDays === r ? 'active' : ''} onClick={() => setRangeDays(r)}>
                  {r} days
                </button>
              ))}
            </div>
            <select
              className="select"
              style={{ width: 220 }}
              value={assignmentId ?? ''}
              onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Assignment"
            >
              <option value="">All assignments</option>
              {assignments.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {data ? (
          <p className="secondary">
            {data.totals.sessions
              ? `${formatDuration(data.totals.totalAltMs)} studied over ${data.totals.sessions} ${data.totals.sessions === 1 ? 'session' : 'sessions'}, ${formatPct(data.totals.avgProductivity)} productive on average.`
              : `No sessions in the last ${rangeDays} days.`}
          </p>
        ) : loading ? (
          <Loading />
        ) : (
          <ErrorText error={error} />
        )}
      </section>

      {data && data.totals.sessions > 0 && (
        <>
          <section className="section">
            <h2>Study time per day</h2>
            <BarSeriesChart
              overlay
              data={data.days.map((d) => ({ date: d.date, durH: h(d.durationMs), altH: h(d.altMs) }))}
              xKey="date"
              xFormat={formatDayKey}
              yFormat={hoursTick}
              series={[
                { key: 'durH', label: 'At your desk', color: colors.tint2, format: (v) => `${v.toFixed(1)} h` },
                { key: 'altH', label: 'Studied', color: colors.productive, format: (v) => `${v.toFixed(1)} h` },
              ]}
            />
          </section>

          <section className="section">
            <h2>Where the time went</h2>
            <ClassBreakdown
              values={{ productive: sum('productiveMs'), neutral: sum('neutralMs'), distracted: sum('distractedMs'), away: sum('awayMs') }}
            />
          </section>

          <section className="section">
            <h2>Best hours</h2>
            <div className="hours">
              {data.hourOfDay.map((x) => (
                <div key={x.hour} title={`${x.hour}:00, ${formatDuration(x.productiveMs)} productive of ${formatDuration(x.trackedMs)}`}>
                  <i
                    style={{
                      background: x.productiveMs > 0 ? 'var(--c-productive)' : 'var(--tint)',
                      opacity: x.productiveMs > 0 ? 0.2 + 0.8 * (x.productiveMs / peak) : 1,
                    }}
                  />
                  <span className="small muted num">{x.hour % 3 === 0 ? x.hour : ''}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {rows.length > 0 && (
        <section className="section">
          <h2>Sessions</h2>
          <SessionTable rows={rows} />
        </section>
      )}
    </div>
  );
}
