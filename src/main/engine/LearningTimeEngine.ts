import type { EngineSettings, IntervalEvaluation, SignalFrame } from '@shared/types';

/**
 * Carry-over state between intervals. Engines must treat it as immutable and return a new
 * value, which keeps evaluation pure and lets tests replay a session deterministically.
 */
export interface EngineState {
  /** Exponential moving average of recent combined scores (sustained-activity context). */
  contextEma: number | null;
  /** Consecutive time the webcam has reported the user absent with no input. */
  absentMs: number;
  /** Start of the current webcam-confirmed absence, if any. */
  absentSinceTs: number | null;
  intervalsEvaluated: number;
}

export const INITIAL_ENGINE_STATE: EngineState = {
  contextEma: null,
  absentMs: 0,
  absentSinceTs: null,
  intervalsEvaluated: 0,
};

export interface EngineResult {
  evaluation: IntervalEvaluation;
  state: EngineState;
}

/**
 * A Learning Time Engine turns monitor observations into a classification. It never touches
 * hardware or storage; alternative algorithms can be registered and selected by id.
 */
export interface LearningTimeEngine {
  readonly id: string;
  readonly name: string;
  evaluate(frame: SignalFrame, state: EngineState, settings: EngineSettings): EngineResult;
}
