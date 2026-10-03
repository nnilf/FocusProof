import type { CameraState, GazePoint } from '@shared/types';
import type { CameraSample, FocusAnalyzer } from '../monitoring/focus/FocusAnalyzer';

const CALIBRATION_SAMPLES_PER_SECOND = 10;
/** Time for the eyes to reach a new on-screen dot before recording. */
const SCREEN_SETTLE_MS = 700;
const SCREEN_CAPTURE_MS = 1_500;
/** Off-screen areas are looked at after clicking, so they get longer to settle. */
const AREA_SETTLE_MS = 1_000;
const AREA_CAPTURE_MS = 2_000;
const START_TIMEOUT_MS = 20_000;
const MIN_SAMPLES = 5;

export interface CalibrationDeps {
  focus: FocusAnalyzer;
  startCamera: (samplesPerSecond: number) => void;
  stopCamera: () => void;
  showTarget: (displayId: number, point: { x: number; y: number; phase: 'settle' | 'capture' }) => Promise<void>;
  hideTarget: () => void;
  isSessionRunning: () => boolean;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Records head pose and eye direction while the user looks at points across each display (shown
 * as a dot) and at areas off the screens, so attention can be measured against every screen
 * rather than only the camera's straight-ahead direction.
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

  /**
   * Shows a dot at x/y (0–1) on the display and records where the user looks, or, without a
   * display, records while they look at an area off the screens.
   */
  async capturePoint(displayId: number | null, x: number, y: number): Promise<GazePoint & { samples: number }> {
    if (!this.running) throw new Error('Calibration has not been started.');
    if (displayId !== null) await this.deps.showTarget(displayId, { x, y, phase: 'settle' });
    else this.deps.hideTarget();
    await wait(displayId !== null ? SCREEN_SETTLE_MS : AREA_SETTLE_MS);
    if (!this.running) throw new Error('Calibration was cancelled.');
    if (displayId !== null) await this.deps.showTarget(displayId, { x, y, phase: 'capture' });

    const samples: CameraSample[] = [];
    this.deps.focus.rawListener = (s) => {
      if (s.facePresent && s.yawDeg !== null && s.pitchDeg !== null) samples.push(s);
    };
    await wait(displayId !== null ? SCREEN_CAPTURE_MS : AREA_CAPTURE_MS);
    this.deps.focus.rawListener = null;
    if (!this.running) throw new Error('Calibration was cancelled.');
    if (samples.length < MIN_SAMPLES) {
      throw new Error('Your face was not detected clearly. Check the lighting and that you are in view, then try again.');
    }
    const withEye = samples.filter((s) => typeof s.eyeX === 'number' && typeof s.eyeY === 'number');
    const eyeKnown = withEye.length >= samples.length / 2;
    return {
      yawDeg: median(samples.map((s) => s.yawDeg ?? 0)),
      pitchDeg: median(samples.map((s) => s.pitchDeg ?? 0)),
      eyeX: eyeKnown ? median(withEye.map((s) => s.eyeX ?? 0)) : null,
      eyeY: eyeKnown ? median(withEye.map((s) => s.eyeY ?? 0)) : null,
      samples: samples.length,
    };
  }

  stop(): void {
    this.deps.hideTarget();
    if (!this.running) return;
    this.running = false;
    this.deps.focus.rawListener = null;
    this.deps.stopCamera();
    this.deps.focus.reset();
  }
}
