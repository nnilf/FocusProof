import type { WeightKey } from './signals';

export interface MonitoringToggles {
  webcam: boolean;
  screenAnalysis: boolean;
  activeWindow: boolean;
  inputActivity: boolean;
  documents: boolean;
}

export type OffScreenPolicy = 'ignore' | 'neutral' | 'distracted';

export interface EngineSettings {
  inactivityThresholdSec: number;
  /** Study material counts as being read (productive) this long after the last scroll or key. */
  readingPauseSec: number;
  awayThresholdSec: number;
  /** Webcam-confirmed absence (with no input) longer than this is away, regardless of awayThresholdSec. */
  absenceThresholdSec: number;
  /** How looking away from every calibrated screen (with no input) is treated. */
  offScreenPolicy: OffScreenPolicy;
  productiveThreshold: number;
  neutralThreshold: number;
  /** Proportion (0–1) of neutral time counted towards Actual Learning Time. */
  neutralContribution: number;
  weights: Record<WeightKey, number>;
}

export interface AppRules {
  productiveApps: string[];
  distractingApps: string[];
  excludedApps: string[];
  productiveKeywords: string[];
  distractingKeywords: string[];
  /** Websites by domain; a rule also matches subdomains (youtube.com matches m.youtube.com). */
  productiveDomains: string[];
  distractingDomains: string[];
}

export type FocusZoneKind = 'screen' | 'distraction';

/**
 * Head pose recorded while the user looked at the centre of something on their desk:
 * - kind 'screen' with a displayId: a monitor of this PC
 * - kind 'screen' without a displayId: a work area such as a paper notepad
 * - kind 'distraction': e.g. a separate laptop, TV or phone stand
 */
/** Head pose and eye direction recorded while looking at one point (eye values null when unknown). */
export interface GazePoint {
  yawDeg: number;
  pitchDeg: number;
  eyeX: number | null;
  eyeY: number | null;
}

export interface FocusZone {
  kind: FocusZoneKind;
  /** The display this screen zone belongs to; null for areas that are not displays of this PC. */
  displayId: number | null;
  label: string;
  yawDeg: number;
  pitchDeg: number;
  /** Points across the zone (corners and edges of a screen); absent for single-point calibrations. */
  points?: GazePoint[];
}

/** How many degrees of gaze eye direction adds, per axis; 0 means head pose only. */
export interface EyeGain {
  x: number;
  y: number;
}

export interface CameraSettings {
  samplesPerSecond: number;
  lookAwayAngleDeg: number;
  /** Empty = not calibrated; the camera's straight-ahead direction is used. */
  zones: FocusZone[];
  /** Fitted during calibration. */
  eyeGain: EyeGain;
}

export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Small always-on-top dot showing the current classification during a session. */
export interface OverlaySettings {
  enabled: boolean;
  corner: OverlayCorner;
  /** Display to show it on; null means the main display. */
  displayId: number | null;
  size: 'small' | 'medium';
  /** Optional extras next to the dot. All off by default to keep it distraction-free. */
  details: { label: boolean; focusScore: boolean; alt: boolean; camera: boolean };
}

export interface Settings {
  engine: EngineSettings;
  analysisIntervalSec: number;
  monitoring: MonitoringToggles;
  apps: AppRules;
  privacy: { storeWindowTitles: boolean; readBrowserDomains: boolean };
  camera: CameraSettings;
  overlay: OverlaySettings;
}

export interface SettingsPatch {
  engine?: Partial<Omit<EngineSettings, 'weights'>> & { weights?: Partial<Record<WeightKey, number>> };
  analysisIntervalSec?: number;
  monitoring?: Partial<MonitoringToggles>;
  apps?: Partial<AppRules>;
  privacy?: Partial<Settings['privacy']>;
  camera?: Partial<Settings['camera']>;
  overlay?: Partial<Omit<OverlaySettings, 'details'>> & { details?: Partial<OverlaySettings['details']> };
}
