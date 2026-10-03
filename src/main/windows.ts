import { BrowserWindow, type WebContents } from 'electron';
import { CAMERA_CHANNELS, type CameraConfig } from '@shared/ipc/camera';
import { preloadPath, resourcePath } from './paths';
import { APP_ORIGIN, devServerUrl } from './security';

export const secureWebPreferences = (preload: string): Electron.WebPreferences => ({
  preload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
});

export function pageUrl(page: 'index' | 'camera' | 'overlay'): string {
  const dev = devServerUrl();
  const file = `${page}.html`;
  return dev ? `${dev}/${file}` : `${APP_ORIGIN}/${file}`;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#111214',
    title: 'FocusProof',
    icon: resourcePath('icon.png'),
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(preloadPath('index')),
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(pageUrl('index'));
  return win;
}

/**
 * Hidden window that runs MediaPipe face landmarks on webcam frames. Only derived numbers
 * (face present, head yaw/pitch) are sent back over IPC; frames never leave this renderer.
 */
export class CameraWindow {
  private win: BrowserWindow | null = null;

  isCameraContents(wc: WebContents): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.webContents.id === wc.id;
  }

  start(config: CameraConfig): void {
    if (this.win && !this.win.isDestroyed()) return;
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: { ...secureWebPreferences(preloadPath('camera')), backgroundThrottling: false },
    });
    this.win = win;
    win.webContents.once('did-finish-load', () => win.webContents.send(CAMERA_CHANNELS.config, config));
    void win.loadURL(pageUrl('camera'));
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
  }

  stop(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
