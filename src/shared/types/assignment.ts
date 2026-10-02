export type MonitoredTargetKind = 'file' | 'folder';

export interface MonitoredTarget {
  id: number;
  assignmentId: number;
  path: string;
  kind: MonitoredTargetKind;
  createdAt: number;
}

export interface Assignment {
  id: number;
  name: string;
  module: string;
  description: string;
  deadline: number | null;
  targetWordCount: number | null;
  currentWordCount: number;
  estimatedHours: number | null;
  notes: string;
  archivedAt: number | null;
  createdAt: number;
  isDemo: boolean;
  targets: MonitoredTarget[];
}

export interface AssignmentInput {
  name: string;
  module: string;
  description: string;
  deadline: number | null;
  targetWordCount: number | null;
  currentWordCount: number;
  estimatedHours: number | null;
  notes: string;
  targets: { path: string; kind: MonitoredTargetKind }[];
}

export interface AssignmentStats {
  assignmentId: number;
  totalAltMs: number;
  totalDurationMs: number;
  sessionCount: number;
  avgProductivity: number | null;
  avgAltPerSessionMs: number | null;
  netWords: number;
  wordsAdded: number;
  /** Productive minutes per 100 net words; null when there is no positive word progress. */
  minutesPer100Words: number | null;
  wordProgress: number | null;
  /** Remaining hours, estimated from the historic word rate or from estimatedHours. */
  estimatedRemainingHours: number | null;
  remainingBasis: 'word-rate' | 'estimated-hours' | 'none';
  activity: { date: string; altMs: number; durationMs: number; netWords: number }[];
}
