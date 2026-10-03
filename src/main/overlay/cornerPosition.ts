import type { OverlayCorner } from '@shared/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const OVERLAY_MARGIN = 12;

/** Room for the minimise, maximise and close buttons (3 × 46px) of a maximised window, so the
 * indicator never sits on top of them in the top-right corner. */
export const CAPTION_BUTTONS_WIDTH = 140;

/** Top-left position that pins a window of `size` into `corner` of a display's work area. */
export function cornerPosition(
  workArea: Rect,
  size: { width: number; height: number },
  corner: OverlayCorner,
  margin = OVERLAY_MARGIN,
): { x: number; y: number } {
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - size.width - margin - (corner === 'top-right' ? CAPTION_BUTTONS_WIDTH : 0);
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - size.height - margin;
  return {
    x: Math.round(corner.endsWith('left') ? left : right),
    y: Math.round(corner.startsWith('top') ? top : bottom),
  };
}
