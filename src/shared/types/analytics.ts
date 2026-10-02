import type { SessionSummaryRow } from './session';

export interface DayPoint {
  date: string;
  altMs: number;
  durationMs: number;
  productiveMs: number;
  neutralMs: number;
  distractedMs: number;
  awayMs: number;
  sessions: number;
}

export interface ClassBreakdown {
  productiveMs: number;
  neutralMs: number;
  distractedMs: number;
  awayMs: number;
}

export interface DashboardData {
  today: {
    altMs: number;
    durationMs: number;
    productivity: number | null;
    sessions: number;
    avgFocus: number | null;
  };
  weekAltMs: number;
  currentAssignment: { id: number; name: string; totalAltMs: number } | null;
  days: DayPoint[];
  byAssignment: { assignmentId: number | null; name: string; altMs: number }[];
  breakdown: ClassBreakdown;
  recent: SessionSummaryRow[];
  hasDemoData: boolean;
}

export interface AnalyticsQuery {
  rangeDays: number;
  assignmentId: number | null;
}

export interface AnalyticsDay extends DayPoint {
  productivity: number | null;
  distractionCount: number;
  netWords: number;
}

export interface AnalyticsData {
  days: AnalyticsDay[];
  weeks: { weekStart: string; altMs: number; durationMs: number }[];
  byAssignment: { assignmentId: number | null; name: string; altMs: number; durationMs: number }[];
  hourOfDay: { hour: number; productiveMs: number; trackedMs: number }[];
  cumulative: { date: string; altHours: number; netWords: number }[];
  totals: {
    sessions: number;
    avgDurationMs: number | null;
    avgAltMs: number | null;
    totalAltMs: number;
    avgProductivity: number | null;
    totalNetWords: number;
  };
}
