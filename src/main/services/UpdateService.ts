import type { UpdateStatus } from '@shared/ipc/contract';

/** The part of electron-updater's autoUpdater this service uses. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each event has its own payload
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateDeps {
  /** Null outside an installed build, where there is nothing to update. */
  updater: Updater | null;
  isSessionRunning: () => boolean;
  onStatus: (status: UpdateStatus) => void;
}

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the app up to date from GitHub releases: checks after startup and every few hours,
 * downloads in the background, and installs when the app quits or the user restarts it.
 */
export class UpdateService {
  private current: UpdateStatus;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: UpdateDeps) {
    this.current = { state: deps.updater ? 'idle' : 'unavailable', version: null };
    const u = deps.updater;
    if (!u) return;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ state: 'checking', version: null }));
    u.on('update-not-available', () => this.set({ state: 'idle', version: null }));
    u.on('update-available', (info: { version: string }) => this.set({ state: 'downloading', version: info.version }));
    u.on('update-downloaded', (info: { version: string }) => this.set({ state: 'ready', version: info.version }));
    u.on('error', (err: Error) => {
      console.warn('[update]', err.message);
      // A download that finished stays installable even if a later check fails.
      if (this.current.state !== 'ready') this.set({ state: 'error', version: null });
    });
  }

  get status(): UpdateStatus {
    return this.current;
  }

  start(): void {
    if (!this.deps.updater) return;
    this.timers.push(setTimeout(() => this.check(), FIRST_CHECK_MS), setInterval(() => this.check(), CHECK_EVERY_MS));
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  install(): void {
    if (!this.deps.updater || this.current.state !== 'ready') throw new Error('No update is ready to install.');
    if (this.deps.isSessionRunning()) throw new Error('End the session before updating.');
    this.deps.updater.quitAndInstall(true, true);
  }

  private check(): void {
    // Once downloaded, the update waits for a restart; checking again would only download it again.
    if (this.current.state === 'ready' || this.current.state === 'downloading') return;
    this.deps.updater?.checkForUpdates().catch((err: unknown) => console.warn('[update] check failed', err));
  }

  private set(status: UpdateStatus): void {
    this.current = status;
    this.deps.onStatus(status);
  }
}
