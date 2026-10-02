// Kept separate from contract.ts so each sandboxed preload bundles without shared chunks.
import type { Classification } from '../types/signals';
import type { OverlaySettings } from '../types/settings';

export const OVERLAY_CHANNELS = {
  state: 'overlay:state',
  resize: 'overlay:resize',
} as const;

/** Everything the indicator draws. Sent from main; the indicator never reads anything itself. */
export interface OverlayState {
  /** null when nothing has been classified yet (or while previewing settings). */
  classification: Classification | null;
  focusScore: number | null;
  altMs: number;
  cameraOn: boolean;
  details: OverlaySettings['details'];
  size: OverlaySettings['size'];
}

export interface OverlayBridge {
  onState(listener: (state: OverlayState) => void): void;
  /** Reports the rendered size so main can pin the window to the chosen corner. */
  resize(width: number, height: number): void;
}
