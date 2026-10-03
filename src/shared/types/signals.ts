export type Classification = 'productive' | 'neutral' | 'distracted' | 'away';
export const CLASSIFICATIONS: readonly Classification[] = ['productive', 'neutral', 'distracted', 'away'];

export type AppCategory = 'productive' | 'neutral' | 'distracting' | 'excluded' | 'unknown';

// Raw observations for one analysis interval. Produced by monitors, consumed by the engine.

export interface WindowObservation {
  processName: string | null;
  title: string | null;
  /** Website domain from the browser's address bar (e.g. "netflix.com"); never a full address. */
  domain: string | null;
  category: AppCategory;
  /** 0–1 relevance of the foreground application; null when the app is excluded. */
  relevance: number | null;
  matchedRule: string | null;
  /** The window shows one of the session's monitored files (the user's own draft). */
  isDraft?: boolean;
}

export interface InputObservation {
  keyboardEvents: number;
  mouseEvents: number;
  /** Seconds within the interval in which any input occurred. */
  activeSeconds: number;
  /** OS-reported idle time at the end of the interval. */
  idleMs: number;
}

export interface ScreenObservation {
  analyzerId: string;
  /** 0–1 relevance of visible content; null when the analyzer cannot judge. */
  relevance: number | null;
  /** 0–1 amount of visual change since the previous capture (scrolling, typing, video). */
  visualChange: number | null;
  note: string | null;
}

export interface CameraObservation {
  samples: number;
  /** Fraction of samples in which a face was detected. */
  presence: number;
  /** Mean attention of samples with a face present, 0–1. */
  focus: number;
  lookingAwayMs: number;
  /** Fraction of face-present samples looking at a calibrated distraction area. */
  distractionRatio: number;
  /** Fraction of face-present samples looking away from every calibrated screen and area. */
  offScreenRatio: number;
  /** The distraction area looked at most, if any. */
  distractionLabel: string | null;
  /** A work area (e.g. notepad) looked at for most of the interval, if any. */
  workAreaLabel: string | null;
}

export interface DocumentObservation {
  changeEvents: number;
  msSinceLastChange: number | null;
  wordsAdded: number;
  wordsRemoved: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: string[];
}

export interface SignalFrame {
  startTs: number;
  endTs: number;
  window: WindowObservation | null;
  input: InputObservation | null;
  screen: ScreenObservation | null;
  camera: CameraObservation | null;
  documents: DocumentObservation | null;
}

/** Normalised 0–1 signal values; null means the signal was unavailable or disabled. */
export interface SignalScores {
  activeWindowRelevance: number | null;
  screenRelevanceScore: number | null;
  inputActivityScore: number | null;
  documentActivityScore: number | null;
  focusScore: number | null;
  presenceScore: number | null;
  contextScore: number | null;
}

export type WeightKey = 'relevance' | 'input' | 'document' | 'camera' | 'context';
export const WEIGHT_KEYS: readonly WeightKey[] = ['relevance', 'input', 'document', 'camera', 'context'];

export interface SignalContribution {
  key: WeightKey;
  value: number | null;
  configuredWeight: number;
  /** Weight after renormalising across the signals that were available. */
  effectiveWeight: number;
  contribution: number;
}

export type ReasonKind = 'positive' | 'negative' | 'neutral' | 'override';

export interface ClassificationReason {
  kind: ReasonKind;
  code: string;
  text: string;
}

export interface IntervalEvaluation {
  engineId: string;
  signals: SignalScores;
  contributions: SignalContribution[];
  /** Weighted score before rule overlays. */
  rawScore: number;
  /** Final score after rule overlays. */
  combinedScore: number;
  classification: Classification;
  reasons: ClassificationReason[];
  /**
   * Set when this interval is classified away: when the away stretch actually began. Earlier
   * intervals from that time on should be relabelled away (the threshold only confirms it).
   */
  awaySinceTs: number | null;
}
