import { z } from 'zod';

const probability = z.number().min(0).max(1);
const nullableInt = z.number().int().min(0).nullable();

const eyeValue = z.number().min(-2).max(2).nullable();

export const gazePointSchema = z.object({
  yawDeg: z.number().min(-90).max(90),
  pitchDeg: z.number().min(-90).max(90),
  eyeX: eyeValue,
  eyeY: eyeValue,
  targetX: z.number().min(0).max(1).optional(),
  targetY: z.number().min(0).max(1).optional(),
});

export const focusZoneSchema = z.object({
  // Calibrations saved before distraction areas existed were all screens.
  kind: z.enum(['screen', 'distraction']).default('screen'),
  displayId: z.number().int().nullable(),
  label: z.string().max(200),
  yawDeg: z.number().min(-90).max(90),
  pitchDeg: z.number().min(-90).max(90),
  points: z.array(gazePointSchema).max(16).optional(),
});

export const calibrationPointSchema = z.object({
  /** The display to show the target on, at x/y (0–1 across it); null for an area off the screens. */
  displayId: z.number().int().nullable(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const monitoringTogglesSchema = z.object({
  webcam: z.boolean(),
  screenAnalysis: z.boolean(),
  activeWindow: z.boolean(),
  inputActivity: z.boolean(),
  documents: z.boolean(),
});

export const targetSchema = z.object({
  path: z.string().min(1).max(2048),
  kind: z.enum(['file', 'folder']),
});

export const assignmentInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  module: z.string().trim().max(200),
  description: z.string().max(5000),
  deadline: z.number().int().nullable(),
  targetWordCount: nullableInt,
  currentWordCount: z.number().int().min(0),
  estimatedHours: z.number().min(0).max(10000).nullable(),
  notes: z.string().max(20000),
  targets: z.array(targetSchema).max(100),
});

export const idSchema = z.object({ id: z.number().int().positive() });
export const updateAssignmentSchema = z.object({ id: z.number().int().positive(), input: assignmentInputSchema });
export const archiveSchema = z.object({ id: z.number().int().positive(), archived: z.boolean() });
export const listAssignmentsSchema = z.object({ includeArchived: z.boolean() });
export const pickPathsSchema = z.object({ folders: z.boolean() });

export const startSessionSchema = z.object({
  assignmentId: z.number().int().positive().nullable(),
  targets: z.array(targetSchema).max(100),
  monitoring: monitoringTogglesSchema,
});

export const listSessionsSchema = z.object({
  assignmentId: z.number().int().positive().nullable(),
  limit: z.number().int().min(1).max(1000),
});

export const analyticsQuerySchema = z.object({
  rangeDays: z.number().int().min(1).max(3650),
  assignmentId: z.number().int().positive().nullable(),
});

const appList = z.array(z.string().trim().min(1).max(200)).max(500);

export const settingsPatchSchema = z.object({
  engine: z
    .object({
      inactivityThresholdSec: z.number().int().min(10).max(3600),
      readingPauseSec: z.number().int().min(30).max(900),
      awayThresholdSec: z.number().int().min(30).max(7200),
      absenceThresholdSec: z.number().int().min(10).max(1800),
      offScreenPolicy: z.enum(['ignore', 'neutral', 'distracted']),
      productiveThreshold: probability,
      neutralThreshold: probability,
      neutralContribution: probability,
      weights: z
        .object({
          relevance: probability,
          input: probability,
          document: probability,
          camera: probability,
          context: probability,
        })
        .partial(),
    })
    .partial()
    .optional(),
  analysisIntervalSec: z.number().int().min(2).max(60).optional(),
  monitoring: monitoringTogglesSchema.partial().optional(),
  apps: z
    .object({
      productiveApps: appList,
      distractingApps: appList,
      excludedApps: appList,
      productiveKeywords: appList,
      distractingKeywords: appList,
      productiveDomains: appList,
      distractingDomains: appList,
    })
    .partial()
    .optional(),
  privacy: z.object({ storeWindowTitles: z.boolean(), readBrowserDomains: z.boolean() }).partial().optional(),
  camera: z
    .object({
      samplesPerSecond: z.number().min(0.2).max(10),
      lookAwayAngleDeg: z.number().min(5).max(80),
      zones: z.array(focusZoneSchema).max(8),
      eyeGain: z.object({ x: z.number().min(-3).max(3), y: z.number().min(-3).max(3) }),
    })
    .partial()
    .optional(),
  overlay: z
    .object({
      enabled: z.boolean(),
      corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
      displayId: z.number().int().nullable(),
      size: z.enum(['small', 'medium']),
      details: z
        .object({ label: z.boolean(), focusScore: z.boolean(), alt: z.boolean(), camera: z.boolean() })
        .partial(),
    })
    .partial()
    .optional(),
});

export const overlayResizeSchema = z.object({
  width: z.number().int().min(8).max(800),
  height: z.number().int().min(8).max(200),
});

export const cameraSampleSchema = z.object({
  ts: z.number(),
  facePresent: z.boolean(),
  yawDeg: z.number().nullable(),
  pitchDeg: z.number().nullable(),
  eyeX: eyeValue.optional(),
  eyeY: eyeValue.optional(),
});

export const cameraStatusSchema = z.object({
  state: z.enum(['starting', 'active', 'unavailable']),
  message: z.string().max(500).nullable(),
});

export const emptySchema = z.object({}).strict();
