import type {
  AnalyticsData,
  AnalyticsDay,
  AnalyticsQuery,
  AssignmentStats,
  DashboardData,
  DayPoint,
  Session,
  SessionMetrics,
} from '@shared/types';
import { addDays, dateKey, lastNDays, startOfDay, startOfWeek } from '@shared/dates';
import type { AssignmentRepository } from '../db/repositories/assignments';
import type { SessionRepository } from '../db/repositories/sessions';
import { MIN_WORDS_FOR_RATE } from './InsightService';

interface Joined {
  session: Session;
  metrics: SessionMetrics;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function emptyDay(date: string): AnalyticsDay {
  return {
    date,
    altMs: 0,
    durationMs: 0,
    productiveMs: 0,
    neutralMs: 0,
    distractedMs: 0,
    awayMs: 0,
    sessions: 0,
    productivity: null,
    distractionCount: 0,
    netWords: 0,
  };
}

/** Aggregates stored per-session metrics into dashboard/analytics views. */
export class AnalyticsService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly assignments: AssignmentRepository,
  ) {}

  private joined(opts: { since?: number; assignmentId?: number | null }): Joined[] {
    const list = this.sessions.list({ since: opts.since, assignmentId: opts.assignmentId ?? null });
    const metrics = this.sessions.allMetrics(list.map((s) => s.id));
    return list.flatMap((session) => {
      const m = metrics.get(session.id);
      return m ? [{ session, metrics: m }] : [];
    });
  }

  private byDay(rows: Joined[], days: string[]): AnalyticsDay[] {
    const map = new Map(days.map((d) => [d, emptyDay(d)]));
    for (const { session, metrics: m } of rows) {
      const day = map.get(dateKey(session.startedAt));
      if (!day) continue;
      day.altMs += m.altMs;
      day.durationMs += m.durationMs;
      day.productiveMs += m.productiveMs;
      day.neutralMs += m.neutralMs;
      day.distractedMs += m.distractedMs;
      day.awayMs += m.awayMs;
      day.sessions += 1;
      day.distractionCount += m.distractionCount;
      day.netWords += m.netWords;
    }
    for (const d of map.values()) d.productivity = d.durationMs > 0 ? d.altMs / d.durationMs : null;
    return [...map.values()];
  }

  dashboard(currentAssignmentId: number | null): DashboardData {
    const now = Date.now();
    const days = lastNDays(14, now);
    const rows = this.joined({ since: addDays(startOfDay(now), -13) });
    const dayPoints: DayPoint[] = this.byDay(rows, days);
    const todayRows = rows.filter((r) => r.session.startedAt >= startOfDay(now));
    const today = todayRows.reduce(
      (acc, r) => ({ altMs: acc.altMs + r.metrics.altMs, durationMs: acc.durationMs + r.metrics.durationMs }),
      { altMs: 0, durationMs: 0 },
    );
    const weekStart = startOfWeek(now);
    const weekAltMs = rows.filter((r) => r.session.startedAt >= weekStart).reduce((n, r) => n + r.metrics.altMs, 0);

    const byAssignment = new Map<number | null, { name: string; altMs: number }>();
    for (const r of rows) {
      const key = r.session.assignmentId;
      const entry = byAssignment.get(key) ?? { name: r.session.assignmentName ?? 'No assignment', altMs: 0 };
      entry.altMs += r.metrics.altMs;
      byAssignment.set(key, entry);
    }

    const breakdown = rows.reduce(
      (acc, r) => ({
        productiveMs: acc.productiveMs + r.metrics.productiveMs,
        neutralMs: acc.neutralMs + r.metrics.neutralMs,
        distractedMs: acc.distractedMs + r.metrics.distractedMs,
        awayMs: acc.awayMs + r.metrics.awayMs,
      }),
      { productiveMs: 0, neutralMs: 0, distractedMs: 0, awayMs: 0 },
    );

    const recentSessions = this.sessions.list({ limit: 6 });
    const recentMetrics = this.sessions.allMetrics(recentSessions.map((s) => s.id));

    let currentAssignment: DashboardData['currentAssignment'] = null;
    const latestAssignmentId = currentAssignmentId ?? recentSessions.find((s) => s.assignmentId)?.assignmentId ?? null;
    if (latestAssignmentId) {
      const a = this.assignments.get(latestAssignmentId);
      if (a) {
        const all = this.joined({ assignmentId: a.id });
        currentAssignment = { id: a.id, name: a.name, totalAltMs: all.reduce((n, r) => n + r.metrics.altMs, 0) };
      }
    }

    const focusValues = todayRows.map((r) => r.metrics.avgFocus).filter((f): f is number => f !== null);
    return {
      today: {
        ...today,
        productivity: today.durationMs > 0 ? today.altMs / today.durationMs : null,
        sessions: todayRows.length,
        avgFocus: mean(focusValues) ?? mean(todayRows.map((r) => r.metrics.avgScore)),
      },
      weekAltMs,
      currentAssignment,
      days: dayPoints,
      byAssignment: [...byAssignment.entries()]
        .map(([assignmentId, v]) => ({ assignmentId, ...v }))
        .sort((a, b) => b.altMs - a.altMs),
      breakdown,
      recent: recentSessions.map((session) => ({ session, metrics: recentMetrics.get(session.id) ?? null })),
      hasDemoData: this.sessions.hasDemo(),
    };
  }

  query(q: AnalyticsQuery): AnalyticsData {
    const now = Date.now();
    const days = lastNDays(q.rangeDays, now);
    const since = addDays(startOfDay(now), -(q.rangeDays - 1));
    const rows = this.joined({ since, assignmentId: q.assignmentId });
    const dayPoints = this.byDay(rows, days);

    const weeks = new Map<string, { weekStart: string; altMs: number; durationMs: number }>();
    for (const d of dayPoints) {
      const wk = dateKey(startOfWeek(new Date(`${d.date}T12:00:00`).getTime()));
      const w = weeks.get(wk) ?? { weekStart: wk, altMs: 0, durationMs: 0 };
      w.altMs += d.altMs;
      w.durationMs += d.durationMs;
      weeks.set(wk, w);
    }

    const byAssignment = new Map<number | null, { name: string; altMs: number; durationMs: number }>();
    for (const r of rows) {
      const e = byAssignment.get(r.session.assignmentId) ?? {
        name: r.session.assignmentName ?? 'No assignment',
        altMs: 0,
        durationMs: 0,
      };
      e.altMs += r.metrics.altMs;
      e.durationMs += r.metrics.durationMs;
      byAssignment.set(r.session.assignmentId, e);
    }

    const hourly = new Map(this.sessions.hourOfDay(rows.map((r) => r.session.id)).map((h) => [h.hour, h]));
    let altSum = 0;
    let wordSum = 0;
    const cumulative = dayPoints.map((d) => {
      altSum += d.altMs;
      wordSum += d.netWords;
      return { date: d.date, altHours: altSum / 3_600_000, netWords: wordSum };
    });

    return {
      days: dayPoints,
      weeks: [...weeks.values()],
      byAssignment: [...byAssignment.entries()]
        .map(([assignmentId, v]) => ({ assignmentId, ...v }))
        .sort((a, b) => b.altMs - a.altMs),
      hourOfDay: Array.from({ length: 24 }, (_, hour) => hourly.get(hour) ?? { hour, productiveMs: 0, trackedMs: 0 }),
      cumulative,
      totals: {
        sessions: rows.length,
        avgDurationMs: mean(rows.map((r) => r.metrics.durationMs)),
        avgAltMs: mean(rows.map((r) => r.metrics.altMs)),
        totalAltMs: altSum,
        avgProductivity: mean(rows.map((r) => r.metrics.productivity)),
        totalNetWords: wordSum,
      },
    };
  }

  assignmentStats(id: number): AssignmentStats {
    const assignment = this.assignments.get(id);
    if (!assignment) throw new Error('Assignment not found');
    const rows = this.joined({ assignmentId: id }).sort((a, b) => a.session.startedAt - b.session.startedAt);
    const totalAltMs = rows.reduce((n, r) => n + r.metrics.altMs, 0);
    const totalProductiveMs = rows.reduce((n, r) => n + r.metrics.productiveMs, 0);
    const netWords = rows.reduce((n, r) => n + r.metrics.netWords, 0);
    const wordsAdded = rows.reduce((n, r) => n + r.metrics.wordsAdded, 0);
    const minutesPer100Words = netWords >= MIN_WORDS_FOR_RATE ? (totalProductiveMs / 60_000 / netWords) * 100 : null;

    const target = assignment.targetWordCount;
    const wordProgress = target ? Math.min(1, assignment.currentWordCount / target) : null;
    let estimatedRemainingHours: number | null = null;
    let remainingBasis: AssignmentStats['remainingBasis'] = 'none';
    if (target && netWords >= 100 && totalAltMs > 0) {
      const remainingWords = Math.max(0, target - assignment.currentWordCount);
      estimatedRemainingHours = (remainingWords / netWords) * (totalAltMs / 3_600_000);
      remainingBasis = 'word-rate';
    } else if (assignment.estimatedHours !== null) {
      estimatedRemainingHours = Math.max(0, assignment.estimatedHours - totalAltMs / 3_600_000);
      remainingBasis = 'estimated-hours';
    }

    const activity = new Map<string, { date: string; altMs: number; durationMs: number; netWords: number }>();
    for (const r of rows) {
      const key = dateKey(r.session.startedAt);
      const e = activity.get(key) ?? { date: key, altMs: 0, durationMs: 0, netWords: 0 };
      e.altMs += r.metrics.altMs;
      e.durationMs += r.metrics.durationMs;
      e.netWords += r.metrics.netWords;
      activity.set(key, e);
    }

    return {
      assignmentId: id,
      totalAltMs,
      totalDurationMs: rows.reduce((n, r) => n + r.metrics.durationMs, 0),
      sessionCount: rows.length,
      avgProductivity: mean(rows.map((r) => r.metrics.productivity)),
      avgAltPerSessionMs: mean(rows.map((r) => r.metrics.altMs)),
      netWords,
      wordsAdded,
      minutesPer100Words,
      wordProgress,
      estimatedRemainingHours,
      remainingBasis,
      activity: [...activity.values()],
    };
  }
}
