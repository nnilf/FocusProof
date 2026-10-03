import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { CHECK_CHANNELS, type CheckConfig, type CheckUpdate } from '@shared/ipc/check';
import type { CameraState, IntervalEvaluation, SignalFrame } from '@shared/types';
import type { SettingsRepository } from '../db/repositories/settings';
import { INITIAL_ENGINE_STATE, type EngineState } from '../engine/LearningTimeEngine';
import { createEngine } from '../engine/registry';
import type { ActivityMonitor } from '../monitoring/ActivityMonitor';
import type { CameraSample, FocusAnalyzer } from '../monitoring/focus/FocusAnalyzer';
import { buildAssignmentKeywords } from '../monitoring/relevanceRules';
import { preloadPath, resourcePath } from '../paths';
import { pageUrl, secureWebPreferences } from '../windows';

export interface CheckDeps {
  settings: SettingsRepository;
  monitor: ActivityMonitor;
  focus: FocusAnalyzer;
  /** The running session's latest evaluation, or null when no session is running. */
  session: () => { frame: SignalFrame; evaluation: IntervalEvaluation; intervalMs: number; nextAt: number } | null;
  isSessionRunning: () => boolean;
}

interface Preview {
  engineState: EngineState;
  lastTickTs: number;
  timer: NodeJS.Timeout | null;
  busy: Promise<void> | null;
  frame: SignalFrame | null;
  evaluation: IntervalEvaluation | null;
  stopping: boolean;
}

/**
 * The calibration check: a visible window that shows the webcam with the detected head direction
 * and every signal the engine weighs. The window runs face detection itself, so frames stay in that
 * renderer. Without a running session, the check drives a dry-run of the monitors and the engine
 * (nothing is saved) so the result matches what a session would decide.
 */
export class CheckService {
  private win: BrowserWindow | null = null;
  private preview: Preview | null = null;
  private cameraActive = false;
  private readonly engine = createEngine();

  constructor(private readonly deps: CheckDeps) {}

  get open(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  isCheckContents(wc: WebContents): boolean {
    return this.open && this.win?.webContents.id === wc.id;
  }

  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'Calibration check',
      icon: resourcePath('icon.png'),
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b2026' : '#eceff2',
      webPreferences: { ...secureWebPreferences(preloadPath('check')), backgroundThrottling: false },
    });
    this.win = win;
    win.once('ready-to-show', () => win.show());
    win.webContents.on('did-finish-load', () => this.send());
    void win.loadURL(pageUrl('check'));
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.cameraActive = false;
      void this.stopPreview();
    });
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }

  onCameraStatus(state: Exclude<CameraState, 'off'>): void {
    this.cameraActive = state === 'active';
    if (this.cameraActive) this.startPreview();
    else void this.stopPreview();
  }

  onSample(sample: CameraSample): void {
    // During a session the session's own camera window feeds the analyzer.
    if (this.preview && !this.deps.isSessionRunning()) this.deps.focus.record(sample);
  }

  /** Called with every live-status update of a running session. */
  onSessionUpdate(): void {
    if (this.open) this.send();
  }

  /** The session needs the monitors: hand them over. */
  async beforeSessionStart(): Promise<void> {
    await this.stopPreview();
  }

  afterSessionEnd(): void {
    if (this.open && this.cameraActive) this.startPreview();
    else this.send();
  }

  private config(): CheckConfig {
    const s = this.deps.settings.get();
    return {
      zones: s.camera.zones,
      eyeGain: s.camera.eyeGain,
      lookAwayDeg: s.camera.lookAwayAngleDeg,
      samplesPerSecond: s.camera.samplesPerSecond,
      offScreenPolicy: s.engine.offScreenPolicy,
      productiveThreshold: s.engine.productiveThreshold,
      neutralThreshold: s.engine.neutralThreshold,
    };
  }

  private send(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const config = this.config();
    const session = this.deps.session();
    let update: CheckUpdate;
    if (this.deps.isSessionRunning()) {
      update = {
        source: 'session',
        config,
        intervalMs: session?.intervalMs ?? 0,
        nextAt: session?.nextAt ?? null,
        frame: session?.frame ?? null,
        evaluation: session?.evaluation ?? null,
      };
    } else {
      const intervalMs = this.deps.settings.get().analysisIntervalSec * 1000;
      const p = this.preview;
      update = {
        source: 'preview',
        config,
        intervalMs,
        nextAt: p && !p.stopping ? p.lastTickTs + intervalMs : null,
        frame: p?.frame ?? null,
        evaluation: p?.evaluation ?? null,
      };
    }
    this.win.webContents.send(CHECK_CHANNELS.update, update);
  }

  private startPreview(): void {
    if (this.preview || this.deps.isSessionRunning() || !this.open) {
      this.send();
      return;
    }
    const settings = this.deps.settings.get();
    const preview: Preview = {
      engineState: INITIAL_ENGINE_STATE,
      lastTickTs: Date.now(),
      timer: null,
      busy: null,
      frame: null,
      evaluation: null,
      stopping: false,
    };
    this.preview = preview;
    const { focus, monitor } = this.deps;
    focus.reset();
    focus.configure(settings.camera.lookAwayAngleDeg, settings.camera.samplesPerSecond, settings.camera.zones, settings.camera.eyeGain);
    focus.setStatus('active', null);
    preview.busy = monitor
      .start({
        // Files belong to assignments, so the preview has none to watch.
        monitoring: { ...settings.monitoring, webcam: true, documents: false },
        targets: [],
        knownPaths: new Set(),
        relevance: { rules: settings.apps, assignmentKeywords: buildAssignmentKeywords(null, []) },
        onDocumentRecord: () => undefined,
        onWarning: (msg) => console.warn('[check]', msg),
        readBrowserDomains: settings.privacy.readBrowserDomains,
      })
      .catch((err: unknown) => console.error('[check] monitor failed to start', err))
      .finally(() => {
        preview.busy = null;
        preview.lastTickTs = Date.now();
        this.schedule(preview);
        this.send();
      });
  }

  private schedule(p: Preview): void {
    if (this.preview !== p || p.stopping) return;
    const ms = this.deps.settings.get().analysisIntervalSec * 1000;
    p.timer = setTimeout(() => {
      p.busy = this.tick(p)
        .catch((err: unknown) => console.error('[check] analysis failed', err))
        .finally(() => {
          p.busy = null;
          this.schedule(p);
        });
    }, ms);
  }

  private async tick(p: Preview): Promise<void> {
    const settings = this.deps.settings.get();
    const now = Date.now();
    this.deps.focus.configure(settings.camera.lookAwayAngleDeg, settings.camera.samplesPerSecond, settings.camera.zones, settings.camera.eyeGain);
    const frame = await this.deps.monitor.collect(p.lastTickTs, now);
    if (this.preview !== p || p.stopping) return;
    p.lastTickTs = now;
    const result = this.engine.evaluate(frame, p.engineState, settings.engine);
    p.engineState = result.state;
    p.frame = frame;
    p.evaluation = result.evaluation;
    this.send();
  }

  private async stopPreview(): Promise<void> {
    const p = this.preview;
    if (!p) return;
    p.stopping = true;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    await p.busy;
    this.preview = null;
    await this.deps.monitor.stop();
    this.deps.focus.reset();
    this.send();
  }
}
