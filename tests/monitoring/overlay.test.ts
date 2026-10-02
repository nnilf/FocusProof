import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings/defaults';
import { cornerPosition } from '../../src/main/overlay/cornerPosition';

// Left monitor at negative x, as on the user's desk; work area excludes a 40px taskbar.
const leftWorkArea = { x: -1920, y: 0, width: 1920, height: 1040 };
const size = { width: 18, height: 18 };

describe('cornerPosition', () => {
  it('pins to each corner of the work area with a margin', () => {
    expect(cornerPosition(leftWorkArea, size, 'top-left')).toEqual({ x: -1908, y: 12 });
    expect(cornerPosition(leftWorkArea, size, 'top-right')).toEqual({ x: -30, y: 12 });
    expect(cornerPosition(leftWorkArea, size, 'bottom-left')).toEqual({ x: -1908, y: 1010 });
    expect(cornerPosition(leftWorkArea, size, 'bottom-right')).toEqual({ x: -30, y: 1010 });
  });
});

describe('indicator settings', () => {
  it('defaults to a bare dot with no extra details', () => {
    expect(DEFAULT_SETTINGS.overlay.enabled).toBe(true);
    expect(Object.values(DEFAULT_SETTINGS.overlay.details).every((v) => v === false)).toBe(true);
  });

  it('merges individual detail toggles without resetting the others', () => {
    const one = mergeSettings(DEFAULT_SETTINGS, { overlay: { details: { label: true } } });
    const two = mergeSettings(one, { overlay: { details: { camera: true }, corner: 'bottom-left' } });
    expect(two.overlay.details).toEqual({ label: true, focusScore: false, alt: false, camera: true });
    expect(two.overlay.corner).toBe('bottom-left');
  });
});
