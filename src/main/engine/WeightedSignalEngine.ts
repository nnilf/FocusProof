import type {
  Classification,
  ClassificationReason,
  EngineSettings,
  SignalContribution,
  SignalFrame,
  SignalScores,
  WeightKey,
} from '@shared/types';
import { WEIGHT_KEYS } from '@shared/types';
import type { EngineResult, EngineState, LearningTimeEngine } from './LearningTimeEngine';
import { cameraValue, clamp01, combinedRelevance, deriveSignals } from './signals';

const CONTEXT_EMA_ALPHA = 0.3;
/** Window/screen relevance at or above this counts as "study content is on screen". */
const RELEVANT = 0.75;
const ABSENT_PRESENCE = 0.25;
const LOOKING_AWAY_FOCUS = 0.4;
const PARTIAL_FOCUS = 0.7;
const LOW_INPUT = 0.2;
/** Webcam presence that confirms the user is at the screen while reading. */
const READING_PRESENCE = 0.75;
/** Share of an interval's webcam samples needed to say where the user was looking. */
const GAZE_MAJORITY = 0.5;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const minutes = (ms: number): string => {
  const m = ms / 60_000;
  return m >= 1 ? `${m.toFixed(1)} min` : `${Math.round(ms / 1000)} s`;
};

export function classifyScore(score: number, settings: EngineSettings): Classification {
  if (score >= settings.productiveThreshold) return 'productive';
  if (score >= settings.neutralThreshold) return 'neutral';
  return 'distracted';
}

/** Weighted mean over available signals; missing signals are dropped and weights renormalised. */
export function weightSignals(
  signals: SignalScores,
  weights: Record<WeightKey, number>,
): { score: number | null; contributions: SignalContribution[] } {
  const values: Record<WeightKey, number | null> = {
    relevance: combinedRelevance(signals),
    input: signals.inputActivityScore,
    document: signals.documentActivityScore,
    camera: cameraValue(signals),
    context: signals.contextScore,
  };
  const available = WEIGHT_KEYS.filter((k) => values[k] !== null && weights[k] > 0);
  const total = available.reduce((sum, k) => sum + weights[k], 0);

  const contributions = WEIGHT_KEYS.map((key): SignalContribution => {
    const value = values[key];
    const effectiveWeight = value !== null && total > 0 && weights[key] > 0 ? weights[key] / total : 0;
    return {
      key,
      value,
      configuredWeight: weights[key],
      effectiveWeight,
      contribution: value !== null ? value * effectiveWeight : 0,
    };
  });
  if (total <= 0) return { score: null, contributions };
  return { score: clamp01(contributions.reduce((s, c) => s + c.contribution, 0)), contributions };
}

/**
 * Default engine: a weighted blend of normalised signals followed by transparent rule overlays
 * (away detection, distracting apps, prolonged inactivity and a reading grace period).
 */
export class WeightedSignalEngine implements LearningTimeEngine {
  readonly id = 'weighted-v1';
  readonly name = 'Weighted signals + rules (v1)';

  evaluate(frame: SignalFrame, state: EngineState, settings: EngineSettings): EngineResult {
    const intervalMs = Math.max(0, frame.endTs - frame.startTs);
    const signals = deriveSignals(frame, state.contextEma);
    const { score, contributions } = weightSignals(signals, settings.weights);
    const reasons: ClassificationReason[] = [];
    const add = (kind: ClassificationReason['kind'], code: string, text: string): void => {
      reasons.push({ kind, code, text });
    };

    const rawScore = score ?? 0.5;
    if (score === null) add('neutral', 'no-signals', 'No monitoring signals were available for this interval');

    const idleMs = frame.input?.idleMs ?? null;
    const docChanges = frame.documents?.changeEvents ?? 0;
    const relevance = combinedRelevance(signals);
    const relevantContent =
      (signals.activeWindowRelevance ?? 0) >= RELEVANT || (signals.screenRelevanceScore ?? 0) >= RELEVANT;
    const cameraKnown = signals.presenceScore !== null;
    const lowInput = (signals.inputActivityScore ?? 0) < LOW_INPUT;
    // Webcam absence only counts when nothing else shows the user is at the computer.
    const absent = cameraKnown && (signals.presenceScore ?? 0) < ABSENT_PRESENCE && lowInput && docChanges === 0;
    const absentMs = absent ? state.absentMs + intervalMs : 0;
    const absentSinceTs = absent ? (state.absentSinceTs ?? frame.startTs) : null;

    this.describeSignals(frame, signals, add);

    const awayMs = settings.awayThresholdSec * 1000;
    const absenceMs = settings.absenceThresholdSec * 1000;
    const inactivityMs = settings.inactivityThresholdSec * 1000;
    const presentOnCamera = cameraKnown && !absent;

    let classification: Classification;
    let combinedScore = rawScore;

    const idleAway = idleMs !== null && idleMs >= awayMs && docChanges === 0 && !presentOnCamera;
    const cameraAway = absent && absentMs >= absenceMs;
    let awaySinceTs: number | null = null;
    if (idleAway || cameraAway) {
      classification = 'away';
      combinedScore = 0;
      const since: number[] = [];
      if (idleAway) {
        add('override', 'away-idle', `No keyboard/mouse input for ${minutes(idleMs ?? 0)}`);
        since.push(frame.endTs - (idleMs ?? 0));
      }
      if (cameraAway) {
        add('override', 'away-absent', `Not detected by the webcam for ${minutes(absentMs)}`);
        if (absentSinceTs !== null) since.push(absentSinceTs);
      }
      awaySinceTs = Math.min(...since);
    } else {
      combinedScore = this.applyOverlays(
        { frame, signals, rawScore, idleMs, docChanges, relevance, relevantContent, inactivityMs, awayMs, absent },
        settings,
        add,
      );
      classification = classifyScore(combinedScore, settings);
    }

    const nextEma =
      state.contextEma === null
        ? combinedScore
        : CONTEXT_EMA_ALPHA * combinedScore + (1 - CONTEXT_EMA_ALPHA) * state.contextEma;

    return {
      evaluation: { engineId: this.id, signals, contributions, rawScore, combinedScore, classification, reasons, awaySinceTs },
      state: { contextEma: nextEma, absentMs, absentSinceTs, intervalsEvaluated: state.intervalsEvaluated + 1 },
    };
  }

  private applyOverlays(
    ctx: {
      frame: SignalFrame;
      signals: SignalScores;
      rawScore: number;
      idleMs: number | null;
      docChanges: number;
      relevance: number | null;
      relevantContent: boolean;
      inactivityMs: number;
      awayMs: number;
      absent: boolean;
    },
    settings: EngineSettings,
    add: (kind: ClassificationReason['kind'], code: string, text: string) => void,
  ): number {
    const belowNeutral = Math.max(0, settings.neutralThreshold - 0.01);
    let score = ctx.rawScore;
    const win = ctx.frame.window;

    const distractingApp = win?.category === 'distracting';
    const distractingScreen = ctx.signals.screenRelevanceScore === 0;
    if ((distractingApp || distractingScreen) && ctx.docChanges === 0) {
      score = Math.min(score, belowNeutral);
      const what = win?.matchedRule ? ` (${win.matchedRule})` : '';
      add('override', 'distracting-content', `Distracting application or site in the foreground${what}`);
      return score;
    }

    // Where the user is looking only decides the outcome when nothing else shows they are working.
    const lowInput = (ctx.signals.inputActivityScore ?? 0) < LOW_INPUT;
    const cam = ctx.frame.camera;
    let offScreenCapped = false;
    if (cam && cam.samples > 0 && lowInput && ctx.docChanges === 0) {
      if (cam.distractionRatio >= GAZE_MAJORITY) {
        add('override', 'looking-at-distraction', `Looking at ${cam.distractionLabel ?? 'a distraction area'}`);
        return Math.min(score, belowNeutral);
      }
      if (cam.offScreenRatio >= GAZE_MAJORITY && settings.offScreenPolicy !== 'ignore') {
        add('override', 'looking-off-screen', 'Looking away from all screens');
        if (settings.offScreenPolicy === 'distracted') return Math.min(score, belowNeutral);
        score = Math.min(score, Math.max(0, settings.productiveThreshold - 0.01));
        offScreenCapped = true;
      }
    }

    const idle = ctx.idleMs ?? 0;
    if (ctx.idleMs !== null && idle >= ctx.inactivityMs && ctx.docChanges === 0 && !ctx.relevantContent) {
      score = Math.min(score, belowNeutral);
      add('override', 'prolonged-inactivity', `No input for ${minutes(idle)} and no study content in focus`);
      return score;
    }

    const reading = ctx.relevantContent && !ctx.absent && !offScreenCapped;

    // Active reading: study material (not the user's own draft) with a scroll or key press within
    // the reading pause counts as productive. A screenful of a paper takes a few minutes to read,
    // so input is sparse; the webcam seeing the user face the screen extends the pause to "away".
    const facingScreen =
      cam !== null && cam.samples > 0 && cam.presence >= READING_PRESENCE && cam.focus >= PARTIAL_FOCUS;
    const pauseMs = facingScreen ? Math.max(ctx.awayMs, settings.readingPauseSec * 1000) : settings.readingPauseSec * 1000;
    if (reading && !win?.isDraft && ctx.idleMs !== null && idle < pauseMs && score < settings.productiveThreshold) {
      add(
        'override',
        'active-reading',
        `Reading study material (last scroll or key ${minutes(idle)} ago${facingScreen ? ', facing the screen' : ''})`,
      );
      return settings.productiveThreshold;
    }

    // Reading grace: relevant material with little input is reading, not inactivity, unless the
    // webcam shows nobody is there or that they are looking elsewhere. The user's own draft
    // without edits stays here: looking at the assignment is not the same as working on it.
    if (reading && idle < ctx.awayMs && score < settings.neutralThreshold) {
      score = settings.neutralThreshold;
      add(
        'override',
        'reading-grace',
        win?.isDraft
          ? 'Assignment open with no edits; counted as neutral'
          : lowInput
            ? 'Study material in focus with little input; treated as reading'
            : 'Study material in focus; score raised to neutral',
      );
    }
    return score;
  }

  private describeSignals(
    frame: SignalFrame,
    signals: SignalScores,
    add: (kind: ClassificationReason['kind'], code: string, text: string) => void,
  ): void {
    const win = frame.window;
    if (win) {
      const app = win.processName ?? 'unknown app';
      if (win.category === 'excluded') add('neutral', 'excluded-app', `${app} is excluded from relevance scoring`);
      else if ((win.relevance ?? 0) >= RELEVANT)
        add('positive', 'relevant-app', `${app} is considered study-related${win.matchedRule ? ` (${win.matchedRule})` : ''}`);
      else if (win.category === 'unknown' || win.category === 'neutral')
        add('neutral', 'unclassified-app', `${app} has no strong relevance rule`);
    }

    const s = frame.screen;
    if (s?.note) add(s.relevance !== null && s.relevance >= RELEVANT ? 'positive' : 'neutral', 'screen', s.note);

    if (frame.input) {
      const i = signals.inputActivityScore ?? 0;
      const events = frame.input.keyboardEvents + frame.input.mouseEvents;
      if (i >= 0.5) add('positive', 'input-active', `Active keyboard/mouse use (${events} input samples)`);
      else if (i < LOW_INPUT) add('negative', 'input-low', 'Little or no keyboard/mouse activity');
    }

    const d = frame.documents;
    if (d && d.changeEvents > 0) {
      const delta = d.wordsAdded || d.wordsRemoved ? ` (+${d.wordsAdded}/−${d.wordsRemoved} words)` : '';
      add('positive', 'doc-change', `Monitored file changed${delta}`);
    } else if (d && (signals.documentActivityScore ?? 0) >= 0.5) {
      add('positive', 'doc-recent', 'Monitored file was edited recently');
    }

    if (signals.presenceScore !== null) {
      if (signals.presenceScore < ABSENT_PRESENCE) add('negative', 'camera-absent', 'No face detected by the webcam');
      else if ((signals.focusScore ?? 0) < LOOKING_AWAY_FOCUS)
        add('negative', 'camera-looking-away', `Looking away from the screen (focus ${pct(signals.focusScore ?? 0)})`);
      else if ((signals.focusScore ?? 0) < PARTIAL_FOCUS)
        add('neutral', 'camera-partial', `Present, partly facing the screen (focus ${pct(signals.focusScore ?? 0)})`);
      else if (frame.camera?.workAreaLabel)
        add('positive', 'camera-work-area', `Looking at ${frame.camera.workAreaLabel} (focus ${pct(signals.focusScore ?? 0)})`);
      else add('positive', 'camera-focused', `Present and facing the screen (focus ${pct(signals.focusScore ?? 0)})`);
    }

    if (signals.contextScore !== null && signals.contextScore >= 0.65)
      add('positive', 'sustained', 'Part of a sustained period of activity');
  }
}
