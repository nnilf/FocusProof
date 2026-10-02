import type { MonitoringToggles } from './settings';
import type {
  AppCategory,
  Classification,
  ClassificationReason,
  SignalContribution,
  SignalScores,
} from './signals';

export type SessionStatus = 'active' | 'completed' | 'recovered';

export interface SessionTarget {
  path: string;
  kind: 'file' | 'folder';
}

export interface SessionConfig {
  monitoring: MonitoringToggles;
  targets: SessionTarget[];
}

export interface Session {
  id: number;
  assignmentId: number | null;
  assignmentName: string | null;
  status: SessionStatus;
  startedAt: number;
  endedAt: number | null;
  lastHeartbeatAt: number;
  config: SessionConfig;
  engineId: string;
  isDemo: boolean;
}

export interface ActivityInterval {
  id: number;
  sessionId: number;
  startTs: number;
  endTs: number;
  classification: Classification;
  combinedScore: number;
  rawScore: number;
  signals: SignalScores;
  contributions: SignalContribution[];
  reasons: ClassificationReason[];
  processName: string | null;
  windowTitle: string | null;
  appCategory: AppCategory | null;
  keyboardEvents: number;
  mouseEvents: number;
  idleMs: number;
  visualChange: number | null;
  docChangeEvents: number;
  wordsAdded: number;
  wordsRemoved: number;
  linesAdded: number;
  linesRemoved: number;
  engineId: string;
}

export type DocumentKind = 'text' | 'docx' | 'code' | 'other';

export interface DocumentSnapshot {
  id: number;
  sessionId: number;
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

export interface SessionMetrics {
  sessionId: number;
  durationMs: number;
  trackedMs: number;
  untrackedMs: number;
  altMs: number;
  productiveMs: number;
  neutralMs: number;
  distractedMs: number;
  awayMs: number;
  /** altMs / durationMs, 0–1. */
  productivity: number;
  avgFocus: number | null;
  avgScore: number;
  longestProductiveMs: number;
  distractionCount: number;
  avgProductiveBlockMs: number;
  wordsAdded: number;
  wordsRemoved: number;
  netWords: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  editingMs: number;
  readingMs: number;
  computedAt: number;
}

export interface TimelineBlock {
  classification: Classification;
  startTs: number;
  endTs: number;
  intervalIds: number[];
}

export interface FileProgress {
  path: string;
  kind: DocumentKind;
  startWords: number | null;
  endWords: number | null;
  wordsAdded: number;
  wordsRemoved: number;
  linesAdded: number;
  linesRemoved: number;
  edits: number;
}

export interface Insight {
  id: string;
  text: string;
  tone: 'info' | 'positive' | 'caution';
}

export interface SessionReport {
  session: Session;
  metrics: SessionMetrics;
  intervals: ActivityInterval[];
  timeline: TimelineBlock[];
  files: FileProgress[];
  insights: Insight[];
  mostProductivePeriod: { startTs: number; endTs: number; altMs: number } | null;
}

export interface SessionSummaryRow {
  session: Session;
  metrics: SessionMetrics | null;
}

export interface StartSessionInput {
  assignmentId: number | null;
  targets: SessionTarget[];
  monitoring: MonitoringToggles;
}

export type CameraState = 'off' | 'starting' | 'active' | 'unavailable';

export interface LiveStatus {
  sessionId: number;
  assignmentName: string | null;
  startedAt: number;
  elapsedMs: number;
  altMs: number;
  classification: Classification | null;
  combinedScore: number | null;
  focusScore: number | null;
  activeApp: string | null;
  idleMs: number;
  docChangeEvents: number;
  netWords: number;
  camera: { state: CameraState; message: string | null };
  monitoring: MonitoringToggles;
  sourceWarnings: string[];
  lastReasons: ClassificationReason[];
}

export interface UnfinishedSession {
  session: Session;
  trackedMs: number;
}
