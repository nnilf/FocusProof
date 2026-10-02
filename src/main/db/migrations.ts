/**
 * Ordered schema migrations. Append new entries; never edit an applied one.
 * Timestamps are epoch milliseconds.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        module TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        deadline INTEGER,
        target_words INTEGER,
        current_words INTEGER NOT NULL DEFAULT 0,
        estimated_hours REAL,
        notes TEXT NOT NULL DEFAULT '',
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        is_demo INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE monitored_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
        created_at INTEGER NOT NULL,
        UNIQUE (assignment_id, path)
      );

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'recovered')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_heartbeat_at INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        engine_id TEXT NOT NULL,
        is_demo INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_sessions_started ON sessions(started_at);
      CREATE INDEX idx_sessions_assignment ON sessions(assignment_id);

      CREATE TABLE activity_intervals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        classification TEXT NOT NULL,
        combined_score REAL NOT NULL,
        raw_score REAL NOT NULL,
        input_score REAL,
        window_relevance REAL,
        screen_relevance REAL,
        document_score REAL,
        focus_score REAL,
        presence_score REAL,
        context_score REAL,
        visual_change REAL,
        keyboard_events INTEGER NOT NULL DEFAULT 0,
        mouse_events INTEGER NOT NULL DEFAULT 0,
        idle_ms INTEGER NOT NULL DEFAULT 0,
        process_name TEXT,
        window_title TEXT,
        app_category TEXT,
        doc_change_events INTEGER NOT NULL DEFAULT 0,
        words_added INTEGER NOT NULL DEFAULT 0,
        words_removed INTEGER NOT NULL DEFAULT 0,
        lines_added INTEGER NOT NULL DEFAULT 0,
        lines_removed INTEGER NOT NULL DEFAULT 0,
        contributions_json TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        engine_id TEXT NOT NULL
      );
      CREATE INDEX idx_intervals_session ON activity_intervals(session_id, start_ts);

      CREATE TABLE document_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        ts INTEGER NOT NULL,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        words INTEGER,
        lines INTEGER,
        words_added INTEGER NOT NULL DEFAULT 0,
        words_removed INTEGER NOT NULL DEFAULT 0,
        lines_added INTEGER NOT NULL DEFAULT 0,
        lines_removed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_snapshots_session ON document_snapshots(session_id, ts);

      CREATE TABLE session_metrics (
        session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        metrics_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        alt_ms INTEGER NOT NULL,
        net_words INTEGER NOT NULL,
        computed_at INTEGER NOT NULL
      );

      CREATE TABLE user_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `,
  },
];
