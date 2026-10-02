import type {
  ActivityInterval,
  AppCategory,
  Classification,
  ClassificationReason,
  DocumentKind,
  DocumentSnapshot,
  IntervalEvaluation,
  Session,
  SessionConfig,
  SessionMetrics,
  SessionStatus,
  SignalContribution,
  SignalFrame,
} from '@shared/types';
import type { Db } from '../connection';

interface SessionRow {
  id: number;
  assignment_id: number | null;
  assignment_name: string | null;
  status: SessionStatus;
  started_at: number;
  ended_at: number | null;
  last_heartbeat_at: number;
  config_json: string;
  engine_id: string;
  is_demo: number;
}

interface IntervalRow {
  id: number;
  session_id: number;
  start_ts: number;
  end_ts: number;
  classification: Classification;
  combined_score: number;
  raw_score: number;
  input_score: number | null;
  window_relevance: number | null;
  screen_relevance: number | null;
  document_score: number | null;
  focus_score: number | null;
  presence_score: number | null;
  context_score: number | null;
  visual_change: number | null;
  keyboard_events: number;
  mouse_events: number;
  idle_ms: number;
  process_name: string | null;
  window_title: string | null;
  app_category: AppCategory | null;
  doc_change_events: number;
  words_added: number;
  words_removed: number;
  lines_added: number;
  lines_removed: number;
  contributions_json: string;
  reasons_json: string;
  engine_id: string;
}

interface SnapshotRow {
  id: number;
  session_id: number;
  path: string;
  kind: DocumentKind;
  ts: number;
  is_baseline: number;
  size_bytes: number;
  mtime_ms: number;
  words: number | null;
  lines: number | null;
  words_added: number;
  words_removed: number;
  lines_added: number;
  lines_removed: number;
}

export interface NewSnapshot {
  path: string;
  kind: DocumentKind;
  ts: number;
  isBaseline: boolean;
  sizeBytes: number;
  mtimeMs: number;
  words: number | null;
  lines: number | null;
  wordsAdded: number;
  wordsRemoved: number;
  linesAdded: number;
  linesRemoved: number;
}

const SESSION_SELECT = `SELECT s.*, a.name AS assignment_name FROM sessions s
  LEFT JOIN assignments a ON a.id = s.assignment_id`;

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export class SessionRepository {
  constructor(private readonly db: Db) {}

  create(input: {
    assignmentId: number | null;
    startedAt: number;
    config: SessionConfig;
    engineId: string;
    isDemo?: boolean;
    status?: SessionStatus;
    endedAt?: number | null;
  }): Session {
    const res = this.db
      .prepare(
        `INSERT INTO sessions (assignment_id, status, started_at, ended_at, last_heartbeat_at, config_json, engine_id, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.assignmentId,
        input.status ?? 'active',
        input.startedAt,
        input.endedAt ?? null,
        input.endedAt ?? input.startedAt,
        JSON.stringify(input.config),
        input.engineId,
        input.isDemo ? 1 : 0,
      );
    const s = this.get(Number(res.lastInsertRowid));
    if (!s) throw new Error('Failed to create session');
    return s;
  }

  get(id: number): Session | null {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
    return row ? this.map(row) : null;
  }

  list(opts: { assignmentId?: number | null; limit?: number; since?: number; status?: SessionStatus[] }): Session[] {
    const where: string[] = [];
    const params: (number | string)[] = [];
    if (opts.assignmentId) {
      where.push('s.assignment_id = ?');
      params.push(opts.assignmentId);
    }
    if (opts.since !== undefined) {
      where.push('s.started_at >= ?');
      params.push(opts.since);
    }
    const statuses = opts.status ?? ['completed', 'recovered'];
    where.push(`s.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
    const sql = `${SESSION_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.started_at DESC ${
      opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : ''
    }`;
    return (this.db.prepare(sql).all(...params) as SessionRow[]).map((r) => this.map(r));
  }

  heartbeat(id: number, ts: number): void {
    this.db.prepare('UPDATE sessions SET last_heartbeat_at = ? WHERE id = ?').run(ts, id);
  }

  finish(id: number, status: SessionStatus, endedAt: number): void {
    this.db
      .prepare('UPDATE sessions SET status = ?, ended_at = ?, last_heartbeat_at = MAX(last_heartbeat_at, ?) WHERE id = ?')
      .run(status, endedAt, endedAt, id);
  }

  reopen(id: number): void {
    this.db.prepare(`UPDATE sessions SET status = 'active', ended_at = NULL WHERE id = ?`).run(id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  insertInterval(
    sessionId: number,
    frame: SignalFrame,
    ev: IntervalEvaluation,
    opts: { storeTitle: boolean },
  ): number {
    const res = this.db
      .prepare(
        `INSERT INTO activity_intervals (session_id, start_ts, end_ts, classification, combined_score, raw_score,
          input_score, window_relevance, screen_relevance, document_score, focus_score, presence_score, context_score,
          visual_change, keyboard_events, mouse_events, idle_ms, process_name, window_title, app_category,
          doc_change_events, words_added, words_removed, lines_added, lines_removed, contributions_json, reasons_json, engine_id)
         VALUES (@sessionId, @startTs, @endTs, @classification, @combinedScore, @rawScore, @inputScore, @windowRelevance,
          @screenRelevance, @documentScore, @focusScore, @presenceScore, @contextScore, @visualChange, @kb, @mouse, @idle,
          @processName, @windowTitle, @appCategory, @docChanges, @wordsAdded, @wordsRemoved, @linesAdded, @linesRemoved,
          @contributions, @reasons, @engineId)`,
      )
      .run({
        sessionId,
        startTs: frame.startTs,
        endTs: frame.endTs,
        classification: ev.classification,
        combinedScore: ev.combinedScore,
        rawScore: ev.rawScore,
        inputScore: ev.signals.inputActivityScore,
        windowRelevance: ev.signals.activeWindowRelevance,
        screenRelevance: ev.signals.screenRelevanceScore,
        documentScore: ev.signals.documentActivityScore,
        focusScore: ev.signals.focusScore,
        presenceScore: ev.signals.presenceScore,
        contextScore: ev.signals.contextScore,
        visualChange: frame.screen?.visualChange ?? null,
        kb: frame.input?.keyboardEvents ?? 0,
        mouse: frame.input?.mouseEvents ?? 0,
        idle: Math.round(frame.input?.idleMs ?? 0),
        processName: frame.window?.processName ?? null,
        windowTitle: opts.storeTitle ? (frame.window?.title?.slice(0, 200) ?? null) : null,
        appCategory: frame.window?.category ?? null,
        docChanges: frame.documents?.changeEvents ?? 0,
        wordsAdded: frame.documents?.wordsAdded ?? 0,
        wordsRemoved: frame.documents?.wordsRemoved ?? 0,
        linesAdded: frame.documents?.linesAdded ?? 0,
        linesRemoved: frame.documents?.linesRemoved ?? 0,
        contributions: JSON.stringify(ev.contributions),
        reasons: JSON.stringify(ev.reasons),
        engineId: ev.engineId,
      });
    return Number(res.lastInsertRowid);
  }

  intervals(sessionId: number): ActivityInterval[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_intervals WHERE session_id = ? ORDER BY start_ts')
      .all(sessionId) as IntervalRow[];
    return rows.map((r) => this.mapInterval(r));
  }

  insertSnapshot(sessionId: number, s: NewSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO document_snapshots (session_id, path, kind, ts, is_baseline, size_bytes, mtime_ms, words, lines,
          words_added, words_removed, lines_added, lines_removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        s.path,
        s.kind,
        s.ts,
        s.isBaseline ? 1 : 0,
        s.sizeBytes,
        Math.round(s.mtimeMs),
        s.words,
        s.lines,
        s.wordsAdded,
        s.wordsRemoved,
        s.linesAdded,
        s.linesRemoved,
      );
  }

  snapshots(sessionId: number): DocumentSnapshot[] {
    const rows = this.db
      .prepare('SELECT * FROM document_snapshots WHERE session_id = ? ORDER BY ts, id')
      .all(sessionId) as SnapshotRow[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      path: r.path,
      kind: r.kind,
      ts: r.ts,
      isBaseline: r.is_baseline === 1,
      sizeBytes: r.size_bytes,
      mtimeMs: r.mtime_ms,
      words: r.words,
      lines: r.lines,
      wordsAdded: r.words_added,
      wordsRemoved: r.words_removed,
      linesAdded: r.lines_added,
      linesRemoved: r.lines_removed,
    }));
  }

  saveMetrics(m: SessionMetrics): void {
    this.db
      .prepare(
        `INSERT INTO session_metrics (session_id, metrics_json, duration_ms, alt_ms, net_words, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET metrics_json=excluded.metrics_json, duration_ms=excluded.duration_ms,
           alt_ms=excluded.alt_ms, net_words=excluded.net_words, computed_at=excluded.computed_at`,
      )
      .run(m.sessionId, JSON.stringify(m), Math.round(m.durationMs), Math.round(m.altMs), m.netWords, m.computedAt);
  }

  metrics(sessionId: number): SessionMetrics | null {
    const row = this.db.prepare('SELECT metrics_json FROM session_metrics WHERE session_id = ?').get(sessionId) as
      | { metrics_json: string }
      | undefined;
    return row ? parseJson<SessionMetrics | null>(row.metrics_json, null) : null;
  }

  allMetrics(sessionIds: number[]): Map<number, SessionMetrics> {
    const out = new Map<number, SessionMetrics>();
    if (sessionIds.length === 0) return out;
    const rows = this.db.prepare('SELECT session_id, metrics_json FROM session_metrics').all() as {
      session_id: number;
      metrics_json: string;
    }[];
    const wanted = new Set(sessionIds);
    for (const r of rows) {
      if (!wanted.has(r.session_id)) continue;
      const m = parseJson<SessionMetrics | null>(r.metrics_json, null);
      if (m) out.set(r.session_id, m);
    }
    return out;
  }

  /** Productive and tracked ms per local hour of day, for "best periods" analytics. */
  hourOfDay(sessionIds: number[]): { hour: number; productiveMs: number; trackedMs: number }[] {
    if (sessionIds.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT CAST(strftime('%H', start_ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
           SUM(CASE WHEN classification = 'productive' THEN end_ts - start_ts ELSE 0 END) AS productive_ms,
           SUM(end_ts - start_ts) AS tracked_ms
         FROM activity_intervals WHERE session_id IN (SELECT value FROM json_each(?)) GROUP BY hour`,
      )
      .all(JSON.stringify(sessionIds)) as { hour: number; productive_ms: number; tracked_ms: number }[];
    return rows.map((r) => ({ hour: r.hour, productiveMs: r.productive_ms, trackedMs: r.tracked_ms }));
  }

  /**
   * Relabels intervals from the start of a confirmed away stretch. Returns the number of rows
   * changed. An interval belongs to the stretch when its midpoint is at or after `sinceTs`.
   */
  markAwaySince(sessionId: number, sinceTs: number): number {
    const reason = JSON.stringify({
      kind: 'override',
      code: 'away-retroactive',
      text: 'Reclassified as away: part of an absence confirmed later',
    });
    return this.db
      .prepare(
        `UPDATE activity_intervals
         SET classification = 'away', combined_score = 0, reasons_json = json_insert(reasons_json, '$[#]', json(?))
         WHERE session_id = ? AND classification != 'away' AND (start_ts + end_ts) / 2 >= ?`,
      )
      .run(reason, sessionId, sinceTs).changes;
  }

  altMs(sessionId: number, neutralContribution: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE classification WHEN 'productive' THEN end_ts - start_ts
           WHEN 'neutral' THEN (end_ts - start_ts) * ? ELSE 0 END), 0) AS ms
         FROM activity_intervals WHERE session_id = ?`,
      )
      .get(neutralContribution, sessionId) as { ms: number };
    return row.ms;
  }

  trackedMs(sessionId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(end_ts - start_ts), 0) AS ms FROM activity_intervals WHERE session_id = ?')
      .get(sessionId) as { ms: number };
    return row.ms;
  }

  deleteDemo(): void {
    this.db.prepare('DELETE FROM sessions WHERE is_demo = 1').run();
  }

  hasDemo(): boolean {
    const a = this.db.prepare('SELECT 1 FROM sessions WHERE is_demo = 1 LIMIT 1').get();
    const b = this.db.prepare('SELECT 1 FROM assignments WHERE is_demo = 1 LIMIT 1').get();
    return Boolean(a ?? b);
  }

  private map(r: SessionRow): Session {
    return {
      id: r.id,
      assignmentId: r.assignment_id,
      assignmentName: r.assignment_name,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      lastHeartbeatAt: r.last_heartbeat_at,
      config: parseJson<SessionConfig>(r.config_json, {
        targets: [],
        monitoring: { webcam: false, screenAnalysis: false, activeWindow: false, inputActivity: false, documents: false },
      }),
      engineId: r.engine_id,
      isDemo: r.is_demo === 1,
    };
  }

  private mapInterval(r: IntervalRow): ActivityInterval {
    return {
      id: r.id,
      sessionId: r.session_id,
      startTs: r.start_ts,
      endTs: r.end_ts,
      classification: r.classification,
      combinedScore: r.combined_score,
      rawScore: r.raw_score,
      signals: {
        activeWindowRelevance: r.window_relevance,
        screenRelevanceScore: r.screen_relevance,
        inputActivityScore: r.input_score,
        documentActivityScore: r.document_score,
        focusScore: r.focus_score,
        presenceScore: r.presence_score,
        contextScore: r.context_score,
      },
      contributions: parseJson<SignalContribution[]>(r.contributions_json, []),
      reasons: parseJson<ClassificationReason[]>(r.reasons_json, []),
      processName: r.process_name,
      windowTitle: r.window_title,
      appCategory: r.app_category,
      keyboardEvents: r.keyboard_events,
      mouseEvents: r.mouse_events,
      idleMs: r.idle_ms,
      visualChange: r.visual_change,
      docChangeEvents: r.doc_change_events,
      wordsAdded: r.words_added,
      wordsRemoved: r.words_removed,
      linesAdded: r.lines_added,
      linesRemoved: r.lines_removed,
      engineId: r.engine_id,
    };
  }
}
