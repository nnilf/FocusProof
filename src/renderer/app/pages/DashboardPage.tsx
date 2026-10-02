import { Link } from 'react-router-dom';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, EmptyState, ErrorText, Loading, PageHeader, Stat } from '../components/ui';
import { BarSeriesChart, HorizontalBars } from '../components/charts';
import { ClassBreakdown } from '../components/ClassBreakdown';
import { SessionTable } from '../components/SessionTable';
import { CLASS_HEX, SERIES_HEX, formatDayKey, formatDuration, formatHours, formatPct, formatScore } from '../lib/format';

const hours = (ms: number): number => Math.round((ms / 3_600_000) * 100) / 100;

export function DashboardPage() {
  const { data, error, loading } = useApi(() => call('analytics:dashboard', {}), []);
  if (!data) return <div className="page">{loading ? <Loading /> : <ErrorText error={error} />}</div>;

  const days = data.days.map((d) => ({ ...d, altH: hours(d.altMs), durH: hours(d.durationMs) }));
  const hasAny = data.recent.length > 0;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        actions={
          <Link to="/session" className="btn primary">
            Start session
          </Link>
        }
      />
      {data.hasDemoData && (
        <div className="banner">
          <span>Showing demo data</span>
          <Link className="btn sm" to="/settings">
            Manage
          </Link>
        </div>
      )}

      <div className="grid cols-4">
        <Stat label="ALT today" value={formatDuration(data.today.altMs)} sub={`${data.today.sessions} sessions`} />
        <Stat label="Session time today" value={formatDuration(data.today.durationMs)} sub={`${formatPct(data.today.productivity)} productive`} />
        <Stat label="ALT this week" value={formatDuration(data.weekAltMs)} />
        <Stat label="Focus today" value={formatScore(data.today.avgFocus)} />
      </div>

      <div className="grid cols-3">
        <Card title="ALT by day" className="span-2">
          <BarSeriesChart
            data={days}
            xKey="date"
            xFormat={formatDayKey}
            yFormat={(v) => `${v.toFixed(1)}h`}
            series={[{ key: 'altH', label: 'ALT', color: CLASS_HEX.productive, format: (v) => `${v.toFixed(1)} h` }]}
          />
        </Card>
        <Card title="Current assignment">
          {data.currentAssignment ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <Link to={`/assignments/${data.currentAssignment.id}`} style={{ fontWeight: 600, fontSize: 16 }}>
                {data.currentAssignment.name}
              </Link>
              <div className="stat">
                <span className="stat-label">Total ALT</span>
                <span className="stat-value num">{formatHours(data.currentAssignment.totalAltMs)}</span>
              </div>
            </div>
          ) : (
            <EmptyState action={<Link className="btn" to="/assignments">Create an assignment</Link>}>No assignment yet.</EmptyState>
          )}
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Session time vs ALT">
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
        <div className="grid">
          <Card title="Time breakdown">
            <ClassBreakdown
              values={{
                productive: data.breakdown.productiveMs,
                neutral: data.breakdown.neutralMs,
                distracted: data.breakdown.distractedMs,
                away: data.breakdown.awayMs,
              }}
            />
          </Card>
          <Card title="ALT by assignment">
            {data.byAssignment.length ? (
              <HorizontalBars
                format={(v) => formatDuration(v)}
                items={data.byAssignment.slice(0, 6).map((a, i) => ({ label: a.name, value: a.altMs, color: SERIES_HEX[i] ?? '#888' }))}
              />
            ) : (
              <p className="muted small">No sessions yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Card title="Recent sessions" actions={<Link className="btn sm ghost" to="/history">View all</Link>}>
        {hasAny ? <SessionTable rows={data.recent} compact /> : <EmptyState>No completed sessions yet.</EmptyState>}
      </Card>
    </div>
  );
}
