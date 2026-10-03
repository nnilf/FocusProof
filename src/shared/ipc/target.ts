// Kept separate from contract.ts so each sandboxed preload bundles without shared chunks.
export const TARGET_CHANNELS = {
  point: 'target:point',
} as const;

/** Where to draw the calibration dot, as a share (0–1) of the display; "settle" while the eyes move to it. */
export interface TargetPoint {
  x: number;
  y: number;
  phase: 'settle' | 'capture';
}

export interface TargetBridge {
  onPoint(listener: (point: TargetPoint) => void): void;
}
