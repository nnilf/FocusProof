import type { Insight, SessionMetrics } from '@shared/types';

const fmtMin = (ms: number): string => `${Math.round(ms / 60_000)} min`;

/** Below this, a per-500-words rate is a wild extrapolation, so actual figures are shown instead. */
export const MIN_WORDS_FOR_RATE = 100;
const fmtHours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} h`;
const fmtClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export interface InsightInput {
  metrics: SessionMetrics;
  assignmentName: string | null;
  assignmentTotalAltMs: number | null;
  /** Mean productivity of the assignment's other sessions. */
  assignmentAvgProductivity: number | null;
  assignmentOtherSessions: number;
  mostProductive: { startTs: number; endTs: number; altMs: number } | null;
}

/** Factual, calculated observations only; no psychological interpretation. */
export function buildInsights(input: InsightInput): Insight[] {
  const { metrics: m } = input;
  const out: Insight[] = [];

  if (m.netWords >= MIN_WORDS_FOR_RATE && m.productiveMs > 0) {
    const per500 = (m.productiveMs / m.netWords) * 500;
    out.push({ id: 'words-rate', tone: 'info', text: `${fmtMin(per500)} of productive time per 500 net words this session.` });
  } else if (m.netWords !== 0 && m.productiveMs > 0) {
    const sign = m.netWords > 0 ? '+' : '';
    out.push({ id: 'words-rate', tone: 'info', text: `${sign}${m.netWords} net words in ${fmtMin(m.productiveMs)} of productive time.` });
  }

  if (input.assignmentTotalAltMs !== null && input.assignmentName) {
    out.push({
      id: 'assignment-total',
      tone: 'info',
      text: `${fmtHours(input.assignmentTotalAltMs)} of Actual Learning Time recorded on "${input.assignmentName}" so far.`,
    });
  }

  if (input.assignmentAvgProductivity !== null && input.assignmentOtherSessions >= 2) {
    const diff = m.productivity - input.assignmentAvgProductivity;
    if (Math.abs(diff) >= 0.03) {
      out.push({
        id: 'vs-average',
        tone: diff > 0 ? 'positive' : 'caution',
        text: `Productivity was ${Math.round(Math.abs(diff) * 100)} points ${diff > 0 ? 'higher' : 'lower'} than this assignment's average (${Math.round(input.assignmentAvgProductivity * 100)}%).`,
      });
    } else {
      out.push({ id: 'vs-average', tone: 'info', text: "Productivity was in line with this assignment's average." });
    }
  }

  if (input.mostProductive && input.mostProductive.altMs >= 60_000) {
    out.push({
      id: 'best-period',
      tone: 'positive',
      text: `Most productive period: ${fmtClock(input.mostProductive.startTs)}–${fmtClock(input.mostProductive.endTs)} (${fmtMin(input.mostProductive.altMs)} of learning time).`,
    });
  }

  const engaged = m.editingMs + m.readingMs;
  if (engaged > 0) {
    const editPct = Math.round((m.editingMs / engaged) * 100);
    out.push({
      id: 'edit-vs-read',
      tone: 'info',
      text: `${editPct}% of engaged time involved editing monitored files; ${100 - editPct}% was reading, research or other work.`,
    });
  }

  if (m.untrackedMs >= 60_000) {
    out.push({
      id: 'untracked',
      tone: 'caution',
      text: `${fmtMin(m.untrackedMs)} of the session was not monitored (app closed or computer asleep) and is excluded from ALT.`,
    });
  }

  if (m.trackedMs > 0 && m.distractedMs / m.trackedMs >= 0.25) {
    out.push({
      id: 'distraction-share',
      tone: 'caution',
      text: `${Math.round((m.distractedMs / m.trackedMs) * 100)}% of monitored time was classified as distracted across ${m.distractionCount} period(s).`,
    });
  }
  return out;
}
