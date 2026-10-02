import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { angleToNearestZone, attentionFromPose } from '../../src/main/monitoring/focus/FocusAnalyzer';
import { RuleBasedScreenAnalyzer } from '../../src/main/monitoring/screen/RuleBasedScreenAnalyzer';
import type { ScreenFrame } from '../../src/main/monitoring/screen/ScreenAnalyzer';

// Main screen straight ahead (camera slightly above it), second screen to the left.
const zones = [
  { yawDeg: 2, pitchDeg: -8 },
  { yawDeg: 38, pitchDeg: -6 },
];

describe('attentionFromPose', () => {
  it('uses straight ahead when uncalibrated', () => {
    expect(attentionFromPose(0, 0, 25)).toBe(1);
    expect(attentionFromPose(40, 0, 25)).toBe(0);
  });

  it('treats looking at a calibrated second monitor as focused', () => {
    expect(attentionFromPose(37, -5, 25, zones)).toBe(1);
    expect(attentionFromPose(2, -8, 25, zones)).toBe(1);
  });

  it('still detects looking away from every screen', () => {
    expect(attentionFromPose(-35, 0, 25, zones)).toBe(0);
    expect(attentionFromPose(2, 30, 25, zones)).toBe(0);
  });

  it('measures the distance to the nearest zone', () => {
    expect(angleToNearestZone(20, -7, zones)).toBe(18);
  });
});

function frame(displayId: string, value: number): ScreenFrame {
  return { displayId, width: 4, height: 1, data: new Uint8Array(16).fill(value) };
}

describe('RuleBasedScreenAnalyzer with multiple displays', () => {
  const relevance = { rules: DEFAULT_SETTINGS.apps, assignmentKeywords: [] };

  it('compares each display with its own previous frame and reports the most active one', async () => {
    const analyzer = new RuleBasedScreenAnalyzer();
    await analyzer.analyze({ processName: null, title: null, relevance, frames: [frame('a', 10), frame('b', 10)] });
    const still = await analyzer.analyze({ processName: null, title: null, relevance, frames: [frame('a', 10), frame('b', 10)] });
    expect(still.visualChange).toBe(0);
    const changed = await analyzer.analyze({ processName: null, title: null, relevance, frames: [frame('a', 10), frame('b', 200)] });
    expect(changed.visualChange).toBe(1);
    expect(changed.note).toContain('1 of 2 displays');
  });
});
