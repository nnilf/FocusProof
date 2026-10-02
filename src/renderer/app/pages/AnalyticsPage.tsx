import { useState } from 'react';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, ErrorText, Loading, PageHeader, Stat } from '../components/ui';
import { BarSeriesChart, HorizontalBars, LineSeriesChart } from '../components/charts';
import { CLASS_HEX, SERIES_HEX, formatDayKey, formatDuration, formatHours, formatPct } from '../lib/format';

const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const h = (ms: number): number => ms / 3_600_000;

export function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const assignments = useApi(() => call('assignments:list', { includeArchived: true }), []);
  const { data, error, loading } = useApi(
    () => call('analytics:query', { rangeDays, assignmentId }),
    [rangeDays, assignmentId],
  );

  const filters = (
    <>
      <div className="tabs" role="tablist" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r.days} role="tab" aria-selected={rangeDays === r.days} className={rangeDays === r.days ? 'active' : ''} onClick={() => setRangeDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>
      <select
        className="select"
        style={{ width: 240 }}
        value={assignmentId ?? ''}
        onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
        aria-label="Filter by assignment"
      >
        <option value="">All assignments</option>
        {assignments.data?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </>
  );

  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Analytics" actions={filters} />
        {loading ? <Loading /> : <ErrorText error={error} />}
      </div>
    );
  }

  const days = data.days.map((d) => ({
    date: d.date,
    altH: h(d.altMs),
    durH: h(d.durationMs),
    productivity: d.productivity !== null ? d.productivity * 100 : null,
    distractedMin: d.distractedMs / 60_000,
    distractions: d.distractionCount,
  }));
  const peak = Math.max(1, ...data.hourOfDay.map((x) => x.productiveMs));

  return (
    <div className="page">
      <PageHeader title="Analytics" actions={filters} />

      <div className="grid cols-4">
        <Stat label="Total ALT" value={formatHours(data.totals.totalAltMs)} sub={`${data.totals.sessions} sessions`} />
        <Stat label="Average session" value={formatDuration(data.totals.avgDurationMs)} />
        <Stat label="Average ALT" value={formatDuration(data.totals.avgAltMs)} />
        <Stat label="Average productivity" value={formatPct(data.totals.avgProductivity)} />
      </div>

      <div className="grid cols-2">
        <Card title="ALT per day">
          <BarSeriesChart
            data={days}
            xKey="date"
            xFormat={formatDayKey}
            yFormat={(v) => `${v.toFixed(1)}h`}
            series={[
              { key: 'durH', label: 'Session time', color: '#6b6c74', format: (v) => `${v.toFixed(1)} h` },
              { key: 'altH', label: 'ALT', color: CLASS_HEX.productive, format: (v) => `${v.toFixed(1)} h` },
            ]}
          />
        </Card>
        <Card title="ALT per week">
          <BarSeriesChart
            data={data.weeks.map((w) => ({ week: w.weekStart, altH: h(w.altMs) }))}
            xKey="week"
            xFormat={(v) => `w/c ${formatDayKey(v)}`}
            yFormat={(v) => `${v.toFixed(0)}h`}
            series={[{ key: 'altH', label: 'ALT', color: CLASS_HEX.productive, format: (v) => `${v.toFixed(1)} h` }]}
          />
        </Card>
        <Card title="Productivity">
          <LineSeriesChart
            data={days}
            xKey="date"
            xFormat={formatDayKey}
            yFormat={(v) => `${v}%`}
            yDomain={[0, 100]}
            series={[{ key: 'productivity', label: 'Productivity', color: CLASS_HEX.neutral, format: (v) => `${v.toFixed(0)}%` }]}
          />
        </Card>
        <Card title="Distracted time">
          <BarSeriesChart
            data={days}
            xKey="date"
            xFormat={formatDayKey}
            yFormat={(v) => `${v.toFixed(0)}m`}
            series={[{ key: 'distractedMin', label: 'Distracted time', color: CLASS_HEX.distracted, format: (v) => `${v.toFixed(0)} min` }]}
          />
        </Card>
        <Card title="Cumulative ALT vs net words">
          <div className="grid cols-2">
            <LineSeriesChart
              area
              height={180}
              data={data.cumulative}
              xKey="date"
              xFormat={formatDayKey}
              yFormat={(v) => `${v.toFixed(0)}h`}
              series={[{ key: 'altHours', label: 'Cumulative ALT', color: CLASS_HEX.productive, format: (v) => `${v.toFixed(1)} h` }]}
            />
            <LineSeriesChart
              area
              height={180}
              data={data.cumulative}
              xKey="date"
              xFormat={formatDayKey}
              yFormat={(v) => v.toFixed(0)}
              series={[{ key: 'netWords', label: 'Cumulative net words', color: SERIES_HEX[0] ?? '#3987e5', format: (v) => `${Math.round(v)} words` }]}
            />
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {data.totals.totalNetWords >= 100 && data.totals.totalAltMs > 0
              ? `${Math.round((h(data.totals.totalAltMs) * 60 * 100) / data.totals.totalNetWords)} min ALT per 100 words`
              : ''}
          </p>
        </Card>
        <Card title="ALT by assignment">
          {data.byAssignment.length ? (
            <HorizontalBars
              format={(v) => formatDuration(v)}
              items={data.byAssignment.map((a, i) => ({ label: a.name, value: a.altMs, color: SERIES_HEX[i % SERIES_HEX.length] ?? '#888' }))}
            />
          ) : (
            <p className="muted small">—</p>
          )}
        </Card>
      </div>

      <Card title="Productive time by hour">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gap: 2 }}>
          {data.hourOfDay.map((x) => (
            <div key={x.hour} style={{ display: 'grid', gap: 4, textAlign: 'center' }} title={`${x.hour}:00 — ${formatDuration(x.productiveMs)} productive of ${formatDuration(x.trackedMs)} monitored`}>
              <div
                style={{
                  height: 36,
                  borderRadius: 3,
                  background: x.productiveMs > 0 ? CLASS_HEX.productive : 'var(--surface-2)',
                  opacity: x.productiveMs > 0 ? 0.25 + 0.75 * (x.productiveMs / peak) : 1,
                }}
              />
              <span className="small muted num">{x.hour % 3 === 0 ? x.hour : ''}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
