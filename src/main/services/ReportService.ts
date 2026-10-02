import type { ActivityInterval, SessionMetrics, SessionReport } from '@shared/types';
import type { SessionRepository } from '../db/repositories/sessions';
import type { SettingsRepository } from '../db/repositories/settings';
import {
  buildTimeline,
  mostProductiveWindow,
  summarizeDocuments,
  summarizeSession,
  type SummaryInterval,
} from '../engine/summary';
import { buildInsights } from './InsightService';

const MOST_PRODUCTIVE_WINDOW_MS = 25 * 60_000;

export const toSummaryInterval = (i: ActivityInterval): SummaryInterval => ({
  id: i.id,
  startTs: i.startTs,
  endTs: i.endTs,
  classification: i.classification,
  combinedScore: i.combinedScore,
  focusScore: i.signals.presenceScore !== null ? (i.signals.focusScore ?? 0) * i.signals.presenceScore : null,
  inputActivityScore: i.signals.inputActivityScore,
  documentActivityScore: i.signals.documentActivityScore,
  docChangeEvents: i.docChangeEvents,
});

export class ReportService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** Recomputes and stores metrics; the stored copy is a cache for history/analytics. */
  computeMetrics(sessionId: number, endedAt: number): SessionMetrics {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const metrics = summarizeSession({
      sessionId,
      startedAt: session.startedAt,
      endedAt,
      intervals: this.sessions.intervals(sessionId).map(toSummaryInterval),
      snapshots: this.sessions.snapshots(sessionId),
      neutralContribution: this.settings.get().engine.neutralContribution,
    });
    this.sessions.saveMetrics(metrics);
    return metrics;
  }

  getReport(sessionId: number): SessionReport | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const intervals = this.sessions.intervals(sessionId);
    const summaryIntervals = intervals.map(toSummaryInterval);
    const metrics =
      this.sessions.metrics(sessionId) ??
      this.computeMetrics(sessionId, session.endedAt ?? session.lastHeartbeatAt);
    const neutral = this.settings.get().engine.neutralContribution;
    const mostProductive = mostProductiveWindow(summaryIntervals, MOST_PRODUCTIVE_WINDOW_MS, neutral);

    let assignmentTotalAltMs: number | null = null;
    let assignmentAvgProductivity: number | null = null;
    let others = 0;
    if (session.assignmentId) {
      const all = this.sessions.list({ assignmentId: session.assignmentId });
      const metricsMap = this.sessions.allMetrics(all.map((s) => s.id));
      assignmentTotalAltMs = [...metricsMap.values()].reduce((n, m) => n + m.altMs, 0);
      const otherMetrics = all.filter((s) => s.id !== sessionId).map((s) => metricsMap.get(s.id)).filter((m) => m !== undefined);
      others = otherMetrics.length;
      assignmentAvgProductivity = others ? otherMetrics.reduce((n, m) => n + m.productivity, 0) / others : null;
    }

    return {
      session,
      metrics,
      intervals,
      timeline: buildTimeline(summaryIntervals),
      files: summarizeDocuments(this.sessions.snapshots(sessionId)),
      mostProductivePeriod: mostProductive,
      insights: buildInsights({
        metrics,
        assignmentName: session.assignmentName,
        assignmentTotalAltMs,
        assignmentAvgProductivity,
        assignmentOtherSessions: others,
        mostProductive,
      }),
    };
  }
}
