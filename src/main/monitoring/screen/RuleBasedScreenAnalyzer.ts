import type { ScreenObservation } from '@shared/types';
import { findKeyword } from '../relevanceRules';
import type { ScreenAnalysisInput, ScreenAnalyzer, ScreenFrame } from './ScreenAnalyzer';

/** Mean absolute luminance difference (0–255) above which a pixel counts as changed. */
const PIXEL_DELTA = 18;

export function luminance(frame: ScreenFrame): Uint8Array {
  const out = new Uint8Array(frame.width * frame.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const b = frame.data[i] ?? 0;
    const g = frame.data[i + 1] ?? 0;
    const r = frame.data[i + 2] ?? 0;
    out[p] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return out;
}

/** Fraction of pixels whose luminance changed noticeably between frames. */
export function visualChange(prev: Uint8Array, next: Uint8Array): number {
  if (prev.length !== next.length || next.length === 0) return 0;
  let changed = 0;
  for (let i = 0; i < next.length; i++) {
    if (Math.abs((next[i] ?? 0) - (prev[i] ?? 0)) > PIXEL_DELTA) changed++;
  }
  return changed / next.length;
}

/**
 * Initial implementation: content relevance from window title keywords, plus a frame-difference
 * measure that distinguishes a static screen from scrolling/reading/typing.
 */
export class RuleBasedScreenAnalyzer implements ScreenAnalyzer {
  readonly id = 'rules-v1';
  private previous = new Map<string, Uint8Array>();

  async analyze(input: ScreenAnalysisInput): Promise<ScreenObservation> {
    const title = input.title ?? '';
    let relevance: number | null = null;
    let note: string | null = null;

    const assignmentHit = findKeyword(title, input.relevance.assignmentKeywords);
    const distractingHit = findKeyword(title, input.relevance.rules.distractingKeywords);
    if (assignmentHit) {
      relevance = 1;
      note = `Visible window refers to "${assignmentHit}"`;
    } else if (distractingHit) {
      relevance = 0;
      note = `Visible window refers to "${distractingHit.trim()}"`;
    }

    // With several monitors, the most active display represents what the user is doing.
    let change: number | null = null;
    let changedDisplays = 0;
    for (const frame of input.frames) {
      const lum = luminance(frame);
      const prev = this.previous.get(frame.displayId);
      this.previous.set(frame.displayId, lum);
      if (!prev) continue;
      const c = Math.min(1, visualChange(prev, lum) * 4);
      if (c > 0.02) changedDisplays++;
      change = Math.max(change ?? 0, c);
    }
    if (change !== null && change > 0.02 && note === null) {
      note =
        input.frames.length > 1
          ? `Screen content is changing on ${changedDisplays} of ${input.frames.length} displays`
          : 'Screen content is changing (scrolling, reading or typing)';
    }
    return { analyzerId: this.id, relevance, visualChange: change, note };
  }

  reset(): void {
    this.previous.clear();
  }

  async dispose(): Promise<void> {
    this.previous.clear();
  }
}
