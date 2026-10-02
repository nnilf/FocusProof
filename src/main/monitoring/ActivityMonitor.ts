import type { MonitoringToggles, SessionTarget, SignalFrame, WindowObservation } from '@shared/types';
import { ActiveWindowMonitor } from './ActiveWindowMonitor';
import { InputActivityMonitor } from './InputActivityMonitor';
import type { Win32ActivitySource } from './Win32ActivitySource';
import { classifyApplication, type RelevanceContext } from './relevanceRules';
import type { ScreenAnalyzer, ScreenFrame } from './screen/ScreenAnalyzer';
import type { FocusAnalyzer } from './focus/FocusAnalyzer';
import type { DocumentActivityAnalyzer, DocumentChangeRecord } from './documents/DocumentActivityAnalyzer';

export interface ActivityMonitorDeps {
  activitySource: Win32ActivitySource | null;
  idleFallbackMs: () => number;
  captureScreens: () => Promise<ScreenFrame[]>;
  screenAnalyzer: ScreenAnalyzer;
  focus: FocusAnalyzer;
  createDocumentAnalyzer: () => DocumentActivityAnalyzer;
}

export interface ActivityMonitorConfig {
  monitoring: MonitoringToggles;
  relevance: RelevanceContext;
  targets: SessionTarget[];
  knownPaths: ReadonlySet<string>;
  onDocumentRecord: (record: DocumentChangeRecord) => void;
  onWarning: (message: string) => void;
  /** Read the website domain from foreground browsers (Privacy setting). */
  readBrowserDomains: boolean;
}

/**
 * Orchestrates every monitoring source and produces one hardware-free SignalFrame per interval.
 * Disabled sources yield null observations so the engine can renormalise around them.
 */
export class ActivityMonitor {
  private windowMonitor = new ActiveWindowMonitor();
  private inputMonitor: InputActivityMonitor;
  private documents: DocumentActivityAnalyzer | null = null;
  private config: ActivityMonitorConfig | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ActivityMonitorDeps) {
    this.inputMonitor = new InputActivityMonitor(deps.idleFallbackMs);
  }

  get activeWindowAvailable(): boolean {
    return this.deps.activitySource !== null;
  }

  async start(config: ActivityMonitorConfig): Promise<void> {
    this.config = config;
    this.windowMonitor = new ActiveWindowMonitor();
    this.inputMonitor = new InputActivityMonitor(this.deps.idleFallbackMs);
    this.deps.screenAnalyzer.reset();

    const needsHelper = config.monitoring.activeWindow || config.monitoring.inputActivity;
    const source = this.deps.activitySource;
    if (needsHelper && source) {
      this.unsubscribe = source.onSample((s) => {
        if (config.monitoring.activeWindow) this.windowMonitor.record(s);
        if (config.monitoring.inputActivity) this.inputMonitor.record(s);
      });
      source.start({ readDomains: config.readBrowserDomains });
    } else if (needsHelper) {
      config.onWarning('Active-window detection is unavailable on this system; using idle time only.');
    }

    if (config.monitoring.documents && config.targets.length > 0) {
      this.documents = this.deps.createDocumentAnalyzer();
      try {
        await this.documents.start({
          targets: config.targets,
          knownPaths: config.knownPaths,
          onRecord: config.onDocumentRecord,
          onError: config.onWarning,
        });
      } catch (err) {
        config.onWarning(`Document monitoring failed to start: ${String(err)}`);
        this.documents = null;
      }
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.deps.activitySource?.stop();
    await this.documents?.stop();
    this.documents = null;
    this.config = null;
  }

  current(): { activeApp: string | null; idleMs: number } {
    return {
      activeApp: this.config?.monitoring.activeWindow ? this.windowMonitor.current().processName : null,
      idleMs: this.config?.monitoring.inputActivity ? this.inputMonitor.idleMs() : 0,
    };
  }

  async collect(startTs: number, endTs: number): Promise<SignalFrame> {
    const cfg = this.config;
    if (!cfg) throw new Error('ActivityMonitor not started');
    const m = cfg.monitoring;

    let window: WindowObservation | null = null;
    if (m.activeWindow && this.deps.activitySource) {
      const fg = this.windowMonitor.drain();
      if (fg) {
        const cls = classifyApplication(fg.processName, fg.title, cfg.relevance, fg.domain);
        window = { processName: fg.processName, title: fg.title, domain: fg.domain, ...cls };
      }
    }

    const input = m.inputActivity ? this.inputMonitor.drain(endTs - startTs) : null;

    const screen = m.screenAnalysis
      ? await this.deps.screenAnalyzer.analyze({
          processName: window?.processName ?? null,
          title: window?.title ?? null,
          relevance: cfg.relevance,
          frames: await this.deps.captureScreens(),
        })
      : null;

    const camera = m.webcam ? this.deps.focus.drain() : null;
    const documents = this.documents ? this.documents.drain(endTs) : null;

    return { startTs, endTs, window, input, screen, camera, documents };
  }
}
