import type { InputObservation } from '@shared/types';
import type { ActivitySample } from './Win32ActivitySource';

/**
 * Aggregates input-activity samples. Only counts and idle durations are kept; the helper never
 * reports which keys were pressed. When the helper is unavailable, an idle-time provider
 * (Electron's powerMonitor) is used instead.
 */
export class InputActivityMonitor {
  private keyboard = 0;
  private mouse = 0;
  private activeSeconds = 0;
  private lastIdleMs: number | null = null;
  private samples = 0;

  constructor(private readonly fallbackIdleMs: () => number) {}

  record(sample: ActivitySample): void {
    this.keyboard += sample.kb;
    this.mouse += sample.ms;
    if (sample.active) this.activeSeconds++;
    this.lastIdleMs = sample.idle;
    this.samples++;
  }

  idleMs(): number {
    return this.lastIdleMs ?? this.fallbackIdleMs();
  }

  drain(intervalMs: number): InputObservation {
    if (this.samples === 0) {
      // Fallback: only idle time is known; approximate active seconds from it.
      const idle = this.fallbackIdleMs();
      const activeMs = Math.max(0, intervalMs - idle);
      return { keyboardEvents: 0, mouseEvents: 0, activeSeconds: Math.round(activeMs / 1000), idleMs: idle };
    }
    const obs: InputObservation = {
      keyboardEvents: this.keyboard,
      mouseEvents: this.mouse,
      activeSeconds: this.activeSeconds,
      idleMs: this.lastIdleMs ?? 0,
    };
    this.keyboard = 0;
    this.mouse = 0;
    this.activeSeconds = 0;
    this.samples = 0;
    return obs;
  }
}
