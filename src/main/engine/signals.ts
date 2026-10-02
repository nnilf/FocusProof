import type { SignalFrame, SignalScores } from '@shared/types';

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Time constant for how long a document edit keeps supporting "active work" afterwards. */
export const DOCUMENT_DECAY_MS = 120_000;
/** Events per minute at which input reaches ~63% of its saturating contribution. */
const INPUT_EVENTS_SCALE = 40;

export function inputActivityScore(frame: SignalFrame): number | null {
  const input = frame.input;
  if (!input) return null;
  const intervalSec = Math.max(1, (frame.endTs - frame.startTs) / 1000);
  const activeRatio = clamp01(input.activeSeconds / intervalSec);
  const eventsPerMin = ((input.keyboardEvents + input.mouseEvents) / intervalSec) * 60;
  const intensity = 1 - Math.exp(-eventsPerMin / INPUT_EVENTS_SCALE);
  return clamp01(0.6 * Math.min(1, activeRatio * 1.25) + 0.4 * intensity);
}

export function documentActivityScore(frame: SignalFrame): number | null {
  const docs = frame.documents;
  if (!docs) return null;
  if (docs.changeEvents > 0) return 1;
  if (docs.msSinceLastChange === null) return 0;
  return clamp01(Math.exp(-docs.msSinceLastChange / DOCUMENT_DECAY_MS));
}

export function deriveSignals(frame: SignalFrame, contextEma: number | null): SignalScores {
  const cam = frame.camera && frame.camera.samples > 0 ? frame.camera : null;
  return {
    activeWindowRelevance: frame.window?.relevance ?? null,
    screenRelevanceScore: frame.screen?.relevance ?? null,
    inputActivityScore: inputActivityScore(frame),
    documentActivityScore: documentActivityScore(frame),
    focusScore: cam ? clamp01(cam.focus) : null,
    presenceScore: cam ? clamp01(cam.presence) : null,
    contextScore: contextEma,
  };
}

/** Window relevance and screen-content relevance are blended into the single relevance weight. */
export function combinedRelevance(signals: SignalScores): number | null {
  const w = signals.activeWindowRelevance;
  const s = signals.screenRelevanceScore;
  if (w !== null && s !== null) return 0.6 * w + 0.4 * s;
  return w ?? s;
}

export function cameraValue(signals: SignalScores): number | null {
  if (signals.presenceScore === null) return null;
  return signals.presenceScore * (signals.focusScore ?? 0);
}
