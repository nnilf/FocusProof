import type { ScreenObservation } from '@shared/types';
import type { RelevanceContext } from '../relevanceRules';

/** A downscaled screen frame held only in memory. Never written to disk. */
export interface ScreenFrame {
  /** Stable per-display identifier, so each monitor is compared with its own previous frame. */
  displayId: string;
  width: number;
  height: number;
  /** BGRA pixel data. */
  data: Uint8Array;
}

export interface ScreenAnalysisInput {
  processName: string | null;
  title: string | null;
  relevance: RelevanceContext;
  /** One frame per display; empty when capture is disabled or unavailable. */
  frames: ScreenFrame[];
}

/**
 * Judges whether visible content relates to the assignment. The rule-based implementation can be
 * replaced by OCR or a local vision model without touching the engine or session code.
 */
export interface ScreenAnalyzer {
  readonly id: string;
  analyze(input: ScreenAnalysisInput): Promise<ScreenObservation>;
  reset(): void;
  dispose(): Promise<void>;
}
