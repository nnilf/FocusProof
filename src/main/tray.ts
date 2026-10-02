import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { LiveStatus } from '@shared/types';

// 16x16 neutral dot generated at runtime so no binary asset is required.
function dotIcon(rgb: [number, number, number]): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const i = (y * size + x) * 4;
      const alpha = d <= 6 ? 255 : d <= 7 ? 128 : 0;
      buf[i] = rgb[2];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[0];
      buf[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const COLORS: Record<string, [number, number, number]> = {
  idle: [120, 120, 128],
  productive: [25, 158, 112],
  neutral: [57, 135, 229],
  distracted: [227, 73, 72],
  away: [93, 92, 88],
};

export class AppTray {
  private tray: Tray;

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.tray = new Tray(dotIcon(COLORS['idle'] ?? [120, 120, 128]));
    this.tray.setToolTip('FocusProof');
    this.tray.on('click', () => this.focus());
    this.update(null);
  }

  update(status: LiveStatus | null): void {
    const state = status?.classification ?? 'idle';
    this.tray.setImage(dotIcon(COLORS[status ? state : 'idle'] ?? [120, 120, 128]));
    const camera = status?.camera.state === 'active' ? ' · camera on' : '';
    this.tray.setToolTip(status ? `FocusProof — session running (${state})${camera}` : 'FocusProof');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: status ? `Session running · ${state}` : 'No session running', enabled: false },
        ...(status?.camera.state === 'active' ? [{ label: 'Camera is active', enabled: false }] : []),
        { type: 'separator' },
        { label: 'Open FocusProof', click: () => this.focus() },
        { role: 'quit', label: 'Quit' },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }

  private focus(): void {
    const w = this.getWindow();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
}
