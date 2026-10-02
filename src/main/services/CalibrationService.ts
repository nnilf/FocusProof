import type { CameraState, FocusZone } from '@shared/types';
import type { CameraSample, FocusAnalyzer } from '../monitoring/focus/FocusAnalyzer';

const CALIBRATION_SAMPLES_PER_SECOND = 5;
const CAPTURE_MS = 3_000;
const START_TIMEOUT_MS = 20_000;
const MIN_SAMPLES = 5;

export interface CalibrationDeps {
  focus: FocusAnalyzer;
  startCamera: (samplesPerSecond: number) => void;
  stopCamera: () => void;
  isSessionRunning: () => boolean;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Records the head pose while the user looks at each display, so attention can be measured
 * against every screen rather than only the camera's straight-ahead direction.
 */
export class CalibrationService {
  private running = false;
  private statusWaiters: ((state: CameraState, message: string | null) => void)[] = [];

  constructor(private readonly deps: CalibrationDeps) {}

  get active(): boolean {
    return this.running;
  }

  /** Called with every camera status update while calibration owns the camera. */
  onCameraStatus(state: CameraState, message: string | null): void {
    for (const w of this.statusWaiters) w(state, message);
  }

  async start(): Promise<void> {
    if (this.deps.isSessionRunning()) throw new Error('End the running session before calibrating the webcam.');
    if (this.running) return;
    this.running = true;
    this.deps.focus.reset();
    this.deps.focus.setStatus('starting', null);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The camera did not start in time.')), START_TIMEOUT_MS);
      this.statusWaiters.push((state, message) => {
        if (state === 'active') {
          clearTimeout(timer);
          resolve();
        } else if (state === 'unavailable') {
          clearTimeout(timer);
          reject(new Error(message ?? 'Camera unavailable'));
        }
      });
    });
    this.deps.startCamera(CALIBRATION_SAMPLES_PER_SECOND);
    try {
      await ready;
    } catch (err) {
      this.stop();
      throw err;
    } finally {
      this.statusWaiters = [];
    }
  }

  async capture(displayId: number, label: string): Promise<FocusZone & { samples: number }> {
    if (!this.running) throw new Error('Calibration has not been started.');
    const samples: CameraSample[] = [];
    this.deps.focus.rawListener = (s) => {
      if (s.facePresent && s.yawDeg !== null && s.pitchDeg !== null) samples.push(s);
    };
    await new Promise((resolve) => setTimeout(resolve, CAPTURE_MS));
    this.deps.focus.rawListener = null;
    if (samples.length < MIN_SAMPLES) {
      throw new Error('Your face was not detected clearly. Check the lighting and that you are in view, then try again.');
    }
    return {
      displayId,
      label,
      yawDeg: median(samples.map((s) => s.yawDeg ?? 0)),
      pitchDeg: median(samples.map((s) => s.pitchDeg ?? 0)),
      samples: samples.length,
    };
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.deps.focus.rawListener = null;
    this.deps.stopCamera();
    this.deps.focus.reset();
  }
}
