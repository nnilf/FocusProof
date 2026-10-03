import type {
  CameraState,
  Classification,
  ClassificationReason,
  IntervalEvaluation,
  LiveStatus,
  Session,
  SignalFrame,
  StartSessionInput,
  UnfinishedSession,
} from '@shared/types';
import type { AssignmentRepository } from '../db/repositories/assignments';
import type { SessionRepository } from '../db/repositories/sessions';
import type { SettingsRepository } from '../db/repositories/settings';
import { INITIAL_ENGINE_STATE, type EngineState, type LearningTimeEngine } from '../engine/LearningTimeEngine';
import { createEngine, DEFAULT_ENGINE_ID } from '../engine/registry';
import { intervalAltMs } from '../engine/summary';
import type { ActivityMonitor } from '../monitoring/ActivityMonitor';
import type { FocusAnalyzer } from '../monitoring/focus/FocusAnalyzer';
import { buildAssignmentKeywords } from '../monitoring/relevanceRules';
import type { ReportService } from './ReportService';
import { toSummaryInterval } from './ReportService';

export interface CameraController {
  start(samplesPerSecond: number): void;
  stop(): void;
}

export interface SessionManagerDeps {
  sessions: SessionRepository;
  assignments: AssignmentRepository;
  settings: SettingsRepository;
  reports: ReportService;
  monitor: ActivityMonitor;
  focus: FocusAnalyzer;
  camera: CameraController;
  emitLive: (status: LiveStatus | null) => void;
  emitEnded: (sessionId: number) => void;
}

interface ActiveState {
  session: Session;
  engine: LearningTimeEngine;
  engineState: EngineState;
  lastTickTs: number;
  timer: NodeJS.Timeout | null;
  busy: Promise<void> | null;
  altMs: number;
  netWordsByPath: Map<string, { baseline: number | null; latest: number | null }>;
  docChangeEvents: number;
  lastEval: IntervalEvaluation | null;
  lastFrame: SignalFrame | null;
  warnings: Set<string>;
  stopping: boolean;
}

/** A tick gap larger than this (e.g. system sleep) is recorded as an explicit away interval. */
const SLEEP_GAP_FACTOR = 6;

export class SessionManager {
  private active: ActiveState | null = null;

  constructor(private readonly deps: SessionManagerDeps) {}

  get activeSessionId(): number | null {
    return this.active?.session.id ?? null;
  }

  async start(input: StartSessionInput): Promise<LiveStatus> {
    if (this.active) throw new Error('A session is already running');
    if (input.assignmentId && !this.deps.assignments.get(input.assignmentId)) throw new Error('Assignment not found');
    const session = this.deps.sessions.create({
      assignmentId: input.assignmentId,
      startedAt: Date.now(),
      config: { monitoring: input.monitoring, targets: input.targets },
      engineId: DEFAULT_ENGINE_ID,
    });
    await this.begin(session, false);
    return this.liveStatus();
  }

  async resume(id: number): Promise<LiveStatus> {
    if (this.active) throw new Error('A session is already running');
    const session = this.deps.sessions.get(id);
    if (!session || session.status !== 'active') throw new Error('Session cannot be resumed');
    await this.begin(session, true);
    return this.liveStatus();
  }

  async end(): Promise<{ sessionId: number }> {
    const a = this.active;
    if (!a) throw new Error('No session is running');
    a.stopping = true;
    if (a.timer) clearTimeout(a.timer);
    a.timer = null;
    await a.busy;
    await this.tick(true);
    await this.shutdownMonitors();
    this.active = null;
    const endedAt = Date.now();
    this.finalize(a.session.id, endedAt, 'completed');
    this.deps.emitLive(null);
    this.deps.emitEnded(a.session.id);
    return { sessionId: a.session.id };
  }

  /** Ends an unfinished session at its last heartbeat (used after a crash). */
  recover(id: number): { sessionId: number } {
    const s = this.deps.sessions.get(id);
    if (!s || s.status !== 'active' || id === this.activeSessionId) throw new Error('Session cannot be recovered');
    this.finalize(id, s.lastHeartbeatAt, 'recovered');
    return { sessionId: id };
  }

  discard(id: number): void {
    if (id === this.activeSessionId) throw new Error('Cannot discard the running session');
    this.deps.sessions.delete(id);
  }

  unfinished(): UnfinishedSession[] {
    return this.deps.sessions
      .list({ status: ['active'] })
      .filter((s) => s.id !== this.activeSessionId)
      .map((session) => ({ session, trackedMs: this.deps.sessions.trackedMs(session.id) }));
  }

  /** Called on app quit: stop monitors but keep the session "active" so it can be resumed. */
  async suspend(): Promise<void> {
    const a = this.active;
    if (!a) return;
    a.stopping = true;
    if (a.timer) clearTimeout(a.timer);
    await a.busy;
    this.deps.sessions.heartbeat(a.session.id, Date.now());
    await this.shutdownMonitors();
    this.active = null;
  }

  setCameraStatus(state: CameraState, message: string | null): void {
    this.deps.focus.setStatus(state, message);
    if (this.active) this.deps.emitLive(this.liveStatus());
  }

  /** The running session's latest evaluated interval and the observations behind it. */
  lastEvaluation(): { frame: SignalFrame; evaluation: IntervalEvaluation; intervalMs: number; nextAt: number } | null {
    const a = this.active;
    if (!a?.lastEval || !a.lastFrame) return null;
    const intervalMs = this.deps.settings.get().analysisIntervalSec * 1000;
    return { frame: a.lastFrame, evaluation: a.lastEval, intervalMs, nextAt: a.lastTickTs + intervalMs };
  }

  liveStatus(): LiveStatus {
    const a = this.active;
    if (!a) throw new Error('No session is running');
    const now = Date.now();
    const cur = this.deps.monitor.current();
    let netWords = 0;
    for (const f of a.netWordsByPath.values()) {
      if (f.baseline !== null && f.latest !== null) netWords += f.latest - f.baseline;
    }
    return {
      sessionId: a.session.id,
      assignmentName: a.session.assignmentName,
      startedAt: a.session.startedAt,
      elapsedMs: now - a.session.startedAt,
      altMs: a.altMs,
      classification: a.lastEval?.classification ?? null,
      combinedScore: a.lastEval?.combinedScore ?? null,
      focusScore: this.deps.focus.currentFocus,
      activeApp: cur.activeApp,
      idleMs: cur.idleMs,
      docChangeEvents: a.docChangeEvents,
      netWords,
      camera: { state: this.deps.focus.state, message: this.deps.focus.message },
      monitoring: a.session.config.monitoring,
      sourceWarnings: [...a.warnings],
      lastReasons: a.lastEval?.reasons ?? [],
    };
  }

  private async begin(session: Session, resuming: boolean): Promise<void> {
    const settings = this.deps.settings.get();
    const assignment = session.assignmentId ? this.deps.assignments.get(session.assignmentId) : null;
    const snapshots = resuming ? this.deps.sessions.snapshots(session.id) : [];
    const netWordsByPath = new Map<string, { baseline: number | null; latest: number | null }>();
    for (const s of snapshots) {
      const entry = netWordsByPath.get(s.path) ?? { baseline: null, latest: null };
      if (s.isBaseline && entry.baseline === null) entry.baseline = s.words;
      entry.latest = s.words;
      netWordsByPath.set(s.path, entry);
    }

    const state: ActiveState = {
      session,
      engine: createEngine(session.engineId),
      engineState: INITIAL_ENGINE_STATE,
      lastTickTs: Date.now(),
      timer: null,
      busy: null,
      altMs: 0,
      netWordsByPath,
      docChangeEvents: 0,
      lastEval: null,
      lastFrame: null,
      warnings: new Set(),
      stopping: false,
    };
    if (resuming) {
      const intervals = this.deps.sessions.intervals(session.id);
      state.altMs = intervals.reduce((n, i) => n + intervalAltMs(toSummaryInterval(i), settings.engine.neutralContribution), 0);
      state.docChangeEvents = intervals.reduce((n, i) => n + i.docChangeEvents, 0);
      this.deps.sessions.reopen(session.id);
    }
    this.active = state;

    await this.deps.monitor.start({
      monitoring: session.config.monitoring,
      targets: session.config.targets,
      knownPaths: new Set(snapshots.map((s) => s.path)),
      relevance: { rules: settings.apps, assignmentKeywords: buildAssignmentKeywords(assignment, session.config.targets) },
      onDocumentRecord: (rec) => {
        if (this.active?.session.id !== session.id) return;
        this.deps.sessions.insertSnapshot(session.id, rec);
        const entry = state.netWordsByPath.get(rec.path) ?? { baseline: null, latest: null };
        if (rec.isBaseline && entry.baseline === null) entry.baseline = rec.words;
        entry.latest = rec.words;
        state.netWordsByPath.set(rec.path, entry);
      },
      onWarning: (msg) => state.warnings.add(msg),
      readBrowserDomains: settings.privacy.readBrowserDomains,
    });

    this.deps.focus.reset();
    this.deps.focus.configure(settings.camera.lookAwayAngleDeg, settings.camera.samplesPerSecond, settings.camera.zones, settings.camera.eyeGain);
    if (session.config.monitoring.webcam) {
      this.deps.focus.setStatus('starting', null);
      this.deps.camera.start(settings.camera.samplesPerSecond);
    }
    state.lastTickTs = Date.now();
    this.schedule();
    this.deps.emitLive(this.liveStatus());
  }

  private schedule(): void {
    const a = this.active;
    if (!a || a.stopping) return;
    const ms = this.deps.settings.get().analysisIntervalSec * 1000;
    a.timer = setTimeout(() => {
      a.busy = this.tick(false)
        .catch((err: unknown) => {
          a.warnings.add(`Analysis error: ${String(err)}`);
        })
        .finally(() => {
          a.busy = null;
          if (this.active === a && !a.stopping) this.schedule();
        });
    }, ms);
  }

  private async tick(final: boolean): Promise<void> {
    const a = this.active;
    if (!a) return;
    const settings = this.deps.settings.get();
    const now = Date.now();
    const intervalMs = settings.analysisIntervalSec * 1000;
    if (final && now - a.lastTickTs < 1000) return;

    let start = a.lastTickTs;
    if (now - start > intervalMs * SLEEP_GAP_FACTOR && now - start > 60_000) {
      this.recordGap(a, start, now - intervalMs);
      start = now - intervalMs;
    }
    const frame = await this.deps.monitor.collect(start, now);
    a.lastTickTs = now;
    const result = a.engine.evaluate(frame, a.engineState, settings.engine);
    a.engineState = result.state;
    this.persist(a, frame, result.evaluation);
    this.deps.emitLive(this.liveStatus());
  }

  private recordGap(a: ActiveState, startTs: number, endTs: number): void {
    const reasons: ClassificationReason[] = [
      { kind: 'override', code: 'system-gap', text: 'No monitoring data (computer asleep or app unresponsive)' },
    ];
    const frame: SignalFrame = { startTs, endTs, window: null, input: null, screen: null, camera: null, documents: null };
    const evaluation: IntervalEvaluation = {
      engineId: a.engine.id,
      signals: {
        activeWindowRelevance: null,
        screenRelevanceScore: null,
        inputActivityScore: null,
        documentActivityScore: null,
        focusScore: null,
        presenceScore: null,
        contextScore: null,
      },
      contributions: [],
      rawScore: 0,
      combinedScore: 0,
      classification: 'away' satisfies Classification,
      reasons,
      awaySinceTs: null,
    };
    this.persist(a, frame, evaluation);
    a.engineState = { ...a.engineState, contextEma: 0 };
  }

  private persist(a: ActiveState, frame: SignalFrame, ev: IntervalEvaluation): void {
    const settings = this.deps.settings.get();
    this.deps.sessions.insertInterval(a.session.id, frame, ev, { storeTitle: settings.privacy.storeWindowTitles });
    this.deps.sessions.heartbeat(a.session.id, frame.endTs);
    const ms = frame.endTs - frame.startTs;
    if (ev.classification === 'productive') a.altMs += ms;
    else if (ev.classification === 'neutral') a.altMs += ms * settings.engine.neutralContribution;
    a.docChangeEvents += frame.documents?.changeEvents ?? 0;
    a.lastEval = ev;
    a.lastFrame = frame;
    if (ev.awaySinceTs !== null) {
      const changed = this.deps.sessions.markAwaySince(a.session.id, ev.awaySinceTs);
      if (changed > 0) a.altMs = this.deps.sessions.altMs(a.session.id, settings.engine.neutralContribution);
    }
  }

  private finalize(sessionId: number, endedAt: number, status: 'completed' | 'recovered'): void {
    this.deps.sessions.finish(sessionId, status, endedAt);
    const metrics = this.deps.reports.computeMetrics(sessionId, endedAt);
    const session = this.deps.sessions.get(sessionId);
    if (session?.assignmentId && metrics.netWords !== 0) {
      const assignment = this.deps.assignments.get(session.assignmentId);
      if (assignment) this.deps.assignments.setCurrentWords(assignment.id, assignment.currentWordCount + metrics.netWords);
    }
  }

  private async shutdownMonitors(): Promise<void> {
    this.deps.camera.stop();
    this.deps.focus.reset();
    await this.deps.monitor.stop();
  }
}
