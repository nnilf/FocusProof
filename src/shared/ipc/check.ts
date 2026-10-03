// Kept separate from contract.ts so each sandboxed preload bundles without shared chunks.
import type { EngineSettings, FocusZone } from '../types/settings';
import type { IntervalEvaluation, SignalFrame } from '../types/signals';

export const CHECK_CHANNELS = {
  model: 'check:model',
  sample: 'check:sample',
  status: 'check:status',
  update: 'check:update',
} as const;

/** The settings the calibration check draws against. */
export interface CheckConfig {
  zones: FocusZone[];
  lookAwayDeg: number;
  samplesPerSecond: number;
  offScreenPolicy: EngineSettings['offScreenPolicy'];
  productiveThreshold: number;
  neutralThreshold: number;
}

/**
 * Pushed from main: the latest interval the engine evaluated. "session" when a study session is
 * running (its own camera window feeds the engine), otherwise "preview": a dry run that is
 * evaluated the same way but never saved.
 */
export interface CheckUpdate {
  source: 'session' | 'preview';
  config: CheckConfig;
  intervalMs: number;
  /** When the next evaluation is due; null while waiting for the camera. */
  nextAt: number | null;
  frame: SignalFrame | null;
  evaluation: IntervalEvaluation | null;
}

export interface CheckBridge {
  getModel(): Promise<Uint8Array | null>;
  /** Derived numbers only; frames never leave the check window. */
  sendSample(sample: { ts: number; facePresent: boolean; yawDeg: number | null; pitchDeg: number | null }): void;
  sendStatus(status: { state: 'starting' | 'active' | 'unavailable'; message: string | null }): void;
  onUpdate(listener: (update: CheckUpdate) => void): void;
}
