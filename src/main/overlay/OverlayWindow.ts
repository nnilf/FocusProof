import { BrowserWindow, screen, type WebContents } from 'electron';
import { OVERLAY_CHANNELS, type OverlayState } from '@shared/ipc/overlay';
import type { LiveStatus, OverlaySettings } from '@shared/types';
import { preloadPath } from '../paths';
import { pageUrl, secureWebPreferences } from '../windows';
import { cornerPosition } from './cornerPosition';

const PREVIEW_MS = 4_000;

/**
 * Tiny always-on-top, click-through window showing the current classification as a coloured dot.
 * It is visible only while a session runs (or briefly after its settings change, as a preview).
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null;
  private size = { width: 24, height: 24 };
  private settings: OverlaySettings;
  private status: LiveStatus | null = null;
  private previewTimer: NodeJS.Timeout | null = null;

  constructor(settings: OverlaySettings) {
    this.settings = settings;
    screen.on('display-metrics-changed', () => this.reposition());
    screen.on('display-removed', () => this.reposition());
  }

  isOverlayContents(wc: WebContents): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.webContents.id === wc.id;
  }

  /** Called with every live-status update (null when the session ends). */
  update(status: LiveStatus | null): void {
    this.status = status;
    this.sync();
  }

  applySettings(settings: OverlaySettings): void {
    const changed = JSON.stringify(settings) !== JSON.stringify(this.settings);
    this.settings = settings;
    if (changed && settings.enabled && !this.status) this.preview();
    else this.sync();
  }

  resize(width: number, height: number): void {
    this.size = { width, height };
    this.reposition();
  }

  destroy(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.win?.destroy();
    this.win = null;
  }

  private preview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.show();
    this.send();
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.sync();
    }, PREVIEW_MS);
  }

  private sync(): void {
    const visible = this.settings.enabled && (this.status !== null || this.previewTimer !== null);
    if (!visible) {
      this.win?.hide();
      return;
    }
    this.show();
    this.send();
  }

  private send(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const state: OverlayState = {
      classification: this.status?.classification ?? null,
      focusScore: this.status?.focusScore ?? this.status?.combinedScore ?? null,
      altMs: this.status?.altMs ?? 0,
      cameraOn: this.status?.camera.state === 'active',
      details: this.settings.details,
      size: this.settings.size,
    };
    this.win.webContents.send(OVERLAY_CHANNELS.state, state);
  }

  private show(): void {
    if (!this.win || this.win.isDestroyed()) this.create();
    this.reposition();
    if (this.win && !this.win.isVisible()) this.win.showInactive();
  }

  private create(): void {
    const win = new BrowserWindow({
      ...this.size,
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
      webPreferences: secureWebPreferences(preloadPath('overlay')),
    });
    // Above normal and most full-screen windows, and never intercepts clicks.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setVisibleOnAllWorkspaces(true);
    win.webContents.on('did-finish-load', () => this.send());
    void win.loadURL(pageUrl('overlay'));
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
  }

  private reposition(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    const display = displays.find((d) => d.id === this.settings.displayId) ?? screen.getPrimaryDisplay();
    const { x, y } = cornerPosition(display.workArea, this.size, this.settings.corner);
    this.win.setBounds({ x, y, ...this.size });
  }
}
