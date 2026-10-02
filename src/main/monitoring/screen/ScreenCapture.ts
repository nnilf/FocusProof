import { desktopCapturer } from 'electron';
import type { ScreenFrame } from './ScreenAnalyzer';

const THUMB = { width: 160, height: 90 };

/**
 * Captures a tiny thumbnail of every display into memory. Nothing is written to disk and the
 * buffers are dropped as soon as the analyzer has derived its numbers.
 */
export async function captureScreens(): Promise<ScreenFrame[]> {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: THUMB });
    return sources.flatMap((source) => {
      const thumb = source.thumbnail;
      if (thumb.isEmpty()) return [];
      const size = thumb.getSize();
      return [{ displayId: source.display_id || source.id, width: size.width, height: size.height, data: new Uint8Array(thumb.toBitmap()) }];
    });
  } catch {
    return [];
  }
}
