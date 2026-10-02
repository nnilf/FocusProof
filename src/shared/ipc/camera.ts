// Kept separate from contract.ts so each sandboxed preload bundles without shared chunks.
export const CAMERA_CHANNELS = {
  sample: 'camera:sample',
  status: 'camera:status',
  config: 'camera:config',
  model: 'camera:model',
} as const;

export interface CameraConfig {
  samplesPerSecond: number;
}

export interface CameraBridge {
  getModel(): Promise<Uint8Array | null>;
  sendSample(sample: { ts: number; facePresent: boolean; yawDeg: number | null; pitchDeg: number | null }): void;
  sendStatus(status: { state: 'starting' | 'active' | 'unavailable'; message: string | null }): void;
  onConfig(listener: (config: CameraConfig) => void): void;
}
