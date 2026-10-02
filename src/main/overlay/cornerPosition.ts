import type { OverlayCorner } from '@shared/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const OVERLAY_MARGIN = 12;

/** Top-left position that pins a window of `size` into `corner` of a display's work area. */
export function cornerPosition(
  workArea: Rect,
  size: { width: number; height: number },
  corner: OverlayCorner,
  margin = OVERLAY_MARGIN,
): { x: number; y: number } {
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - size.width - margin;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - size.height - margin;
  return {
    x: Math.round(corner.endsWith('left') ? left : right),
    y: Math.round(corner.startsWith('top') ? top : bottom),
  };
}
