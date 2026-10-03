import { BrowserWindow, screen } from 'electron';
import { TARGET_CHANNELS, type TargetPoint } from '@shared/ipc/target';
import { preloadPath } from '../paths';
import { pageUrl, secureWebPreferences } from '../windows';

/**
 * A see-through, click-through window covering one display, showing the dot to look at while
 * calibrating. It never takes focus, so the main window keeps the keyboard.
 */
export class TargetWindow {
  private win: BrowserWindow | null = null;
  private loaded: Promise<void> | null = null;
  private displayId: number | null = null;

  async show(displayId: number, point: TargetPoint): Promise<void> {
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!display) throw new Error('That display is no longer connected.');
    if (!this.win || this.win.isDestroyed()) this.create();
    const win = this.win;
    if (!win) return;
    if (this.displayId !== displayId) {
      win.setBounds(display.bounds);
      this.displayId = displayId;
    }
    await this.loaded;
    if (win.isDestroyed()) return;
    if (!win.isVisible()) win.showInactive();
    win.webContents.send(TARGET_CHANNELS.point, point);
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.loaded = null;
    this.displayId = null;
  }

  private create(): void {
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: secureWebPreferences(preloadPath('target')),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    this.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    void win.loadURL(pageUrl('target'));
    win.on('closed', () => {
      if (this.win === win) this.hide();
    });
    this.win = win;
  }
}
