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
}

export type FocusZoneKind = 'screen' | 'distraction';

/**
 * Head pose recorded while the user looked at the centre of a screen they work on, or at a
 * distraction area (e.g. a separate laptop, TV or phone stand).
 */
export interface FocusZone {
  kind: FocusZoneKind;
  /** The display this screen zone belongs to; null for areas that are not displays of this PC. */
  displayId: number | null;
  label: string;
  yawDeg: number;
  pitchDeg: number;
}

export interface CameraSettings {
  samplesPerSecond: number;
  lookAwayAngleDeg: number;
  /** Empty = not calibrated; the camera's straight-ahead direction is used. */
  zones: FocusZone[];
}

export interface Settings {
  engine: EngineSettings;
  analysisIntervalSec: number;
  monitoring: MonitoringToggles;
  apps: AppRules;
  privacy: { storeWindowTitles: boolean };
  camera: CameraSettings;
}

export interface SettingsPatch {
  engine?: Partial<Omit<EngineSettings, 'weights'>> & { weights?: Partial<Record<WeightKey, number>> };
  analysisIntervalSec?: number;
  monitoring?: Partial<MonitoringToggles>;
  apps?: Partial<AppRules>;
  privacy?: Partial<Settings['privacy']>;
  camera?: Partial<Settings['camera']>;
}
