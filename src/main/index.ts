import { app, BrowserWindow, dialog, ipcMain, powerMonitor, screen, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAMERA_CHANNELS } from '@shared/ipc/camera';
import { CHECK_CHANNELS } from '@shared/ipc/check';
import { startOfDay } from '@shared/dates';
import { correctedEyeGain } from '@shared/focus/gaze';
import type { IpcEventName, IpcEvents } from '@shared/ipc/contract';
import { OVERLAY_CHANNELS } from '@shared/ipc/overlay';
import { cameraSampleSchema, cameraStatusSchema, overlayResizeSchema } from '@shared/ipc/schemas';
import type { LiveStatus } from '@shared/types';
import { openDatabase, type Db } from './db/connection';
import { AssignmentRepository } from './db/repositories/assignments';
import { SessionRepository } from './db/repositories/sessions';
import { SettingsRepository } from './db/repositories/settings';
import { registerHandlers } from './ipc/handlers';
import { ActivityMonitor } from './monitoring/ActivityMonitor';
import { FileSystemDocumentAnalyzer } from './monitoring/documents/DocumentActivityAnalyzer';
import { FocusAnalyzer } from './monitoring/focus/FocusAnalyzer';
import { RuleBasedScreenAnalyzer } from './monitoring/screen/RuleBasedScreenAnalyzer';
import { captureScreens } from './monitoring/screen/ScreenCapture';
import { Win32ActivitySource } from './monitoring/Win32ActivitySource';
import { resourcePath } from './paths';
import { configurePermissions, hardenContents, isAppUrl, registerAppProtocol, registerSchemes } from './security';
import { AnalyticsService } from './services/AnalyticsService';
import { CalibrationService } from './services/CalibrationService';
import { CheckService } from './services/CheckService';
import { DemoDataService } from './services/DemoDataService';
import { ReportService } from './services/ReportService';
import { SessionManager } from './services/SessionManager';
import { UpdateService } from './services/UpdateService';
import { AppTray } from './tray';
import { TargetWindow } from './calibration/TargetWindow';
import { OverlayWindow } from './overlay/OverlayWindow';
import { CameraWindow, createMainWindow } from './windows';

registerSchemes();
// Own taskbar identity, so Windows shows the FocusProof icon rather than grouping under Electron.
app.setAppUserModelId('com.focusproof.app');

// Allows isolated data directories for testing or multiple profiles.
const userDataOverride = process.env['FOCUSPROOF_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: AppTray | null = null;
let overlay: OverlayWindow | null = null;
let db: Db | null = null;
let quitting = false;

/** Notifies the renderer that data changed, passing the handler result through. */
function changed<T>(scope: IpcEvents['data:changed']['scope'], result: T): T {
  emit('data:changed', { scope });
  return result;
}

function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
}

async function bootstrap(): Promise<void> {
  registerAppProtocol();
  db = openDatabase(join(app.getPath('userData'), 'focusproof.db'));
  const assignments = new AssignmentRepository(db);
  const sessions = new SessionRepository(db);
  const settings = new SettingsRepository(db);
  // Calibrations from before 0.3.1 may have saved a reversed eye gain; refit it from their points.
  const stored = settings.get().camera;
  const eyeGain = correctedEyeGain(stored.zones, stored.eyeGain);
  if (eyeGain) {
    settings.update({ camera: { eyeGain } });
    console.log('[calibration] corrected reversed eye gain', stored.eyeGain, '->', eyeGain);
  }
  const reports = new ReportService(sessions, settings);
  const analytics = new AnalyticsService(sessions, assignments);
  const demo = new DemoDataService(db, assignments, sessions, settings, reports);
  const cameraWindow = new CameraWindow();
  const s = settings.get();
  const focus = new FocusAnalyzer(s.camera.lookAwayAngleDeg, s.camera.samplesPerSecond);
  overlay = new OverlayWindow(s.overlay);

  const helperScript = resourcePath('win32', 'activity-helper.ps1');
  const activitySource = Win32ActivitySource.isSupported(helperScript) ? new Win32ActivitySource(helperScript) : null;
  const monitor = new ActivityMonitor({
    activitySource,
    idleFallbackMs: () => powerMonitor.getSystemIdleTime() * 1000,
    captureScreens,
    screenAnalyzer: new RuleBasedScreenAnalyzer(),
    focus,
    createDocumentAnalyzer: () => new FileSystemDocumentAnalyzer(),
  });

  const sessionManager = new SessionManager({
    sessions,
    assignments,
    settings,
    reports,
    monitor,
    focus,
    camera: {
      start: (samplesPerSecond) => cameraWindow.start({ samplesPerSecond }),
      stop: () => cameraWindow.stop(),
    },
    emitLive: (status: LiveStatus | null) => {
      emit('session:live', status);
      tray?.update(status);
      overlay?.update(status);
      check.onSessionUpdate();
    },
    emitEnded: (sessionId) => {
      emit('session:ended', { sessionId });
      emit('data:changed', { scope: 'sessions' });
      check.afterSessionEnd();
    },
  });

  const check = new CheckService({
    settings,
    monitor,
    focus,
    session: () => sessionManager.lastEvaluation(),
    isSessionRunning: () => sessionManager.activeSessionId !== null,
  });

  const target = new TargetWindow();
  const calibration = new CalibrationService({
    focus,
    startCamera: (samplesPerSecond) => cameraWindow.start({ samplesPerSecond }),
    stopCamera: () => cameraWindow.stop(),
    showTarget: (displayId, point) => target.show(displayId, point),
    hideTarget: () => target.hide(),
    isSessionRunning: () => sessionManager.activeSessionId !== null,
  });

  const updates = new UpdateService({
    updater: app.isPackaged ? autoUpdater : null,
    isSessionRunning: () => sessionManager.activeSessionId !== null,
    onStatus: (status) => emit('update:status', status),
  });
  updates.start();

  // Fresh installs get the setup wizard once; existing users find it in Settings.
  const firstRun = settings.getValue('settings') === undefined && !sessions.hasOwnSessions();

  if (settings.getValue('demoSeeded') !== true && assignments.list(true).length === 0) {
    try {
      demo.seed();
    } catch (err) {
      console.error('[demo] seeding failed', err);
    }
  }

  const modelPath = resourcePath('models', 'face_landmarker.task');
  const isMainSender = (event: IpcMainInvokeEvent): boolean =>
    mainWindow !== null && event.sender.id === mainWindow.webContents.id && isAppUrl(event.senderFrame?.url ?? '');

  registerHandlers(
    {
      'app:info': () => ({
        version: app.getVersion(),
        platform: process.platform,
        dataPath: app.getPath('userData'),
        capabilities: { activeWindow: activitySource !== null, cameraModel: existsSync(modelPath) },
      }),
      'assignments:list': (req) => assignments.list(req.includeArchived),
      'assignments:get': (req) => assignments.get(req.id),
      'assignments:create': (req) => changed('assignments', assignments.create(req)),
      'assignments:update': (req) => changed('assignments', assignments.update(req.id, req.input)),
      'assignments:archive': (req) => changed('assignments', assignments.setArchived(req.id, req.archived)),
      'assignments:delete': (req) => changed('assignments', assignments.delete(req.id)),
      'assignments:stats': (req) => analytics.assignmentStats(req.id),
      'dialog:pickPaths': async (req) => {
        if (!mainWindow) return [];
        const res = await dialog.showOpenDialog(mainWindow, {
          properties: req.folders ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
        });
        return res.canceled ? [] : res.filePaths;
      },
      'sessions:start': async (req) => {
        if (calibration.active) throw new Error('Finish webcam calibration before starting a session.');
        await check.beforeSessionStart();
        return sessionManager.start(req);
      },
      'sessions:end': () => sessionManager.end(),
      'sessions:live': () => (sessionManager.activeSessionId ? sessionManager.liveStatus() : null),
      'sessions:list': (req) => {
        const list = sessions.list({ assignmentId: req.assignmentId, limit: req.limit });
        const metrics = sessions.allMetrics(list.map((x) => x.id));
        return list.map((session) => ({ session, metrics: metrics.get(session.id) ?? null }));
      },
      'sessions:report': (req) => reports.getReport(req.id),
      'sessions:day': () =>
        sessions
          .list({ since: startOfDay(Date.now()), limit: 100 })
          .map((s) => ({ sessionId: s.id, assignmentName: s.assignmentName, blocks: reports.getReport(s.id)?.timeline ?? [] })),
      'sessions:delete': (req) => {
        if (req.id === sessionManager.activeSessionId) throw new Error('End the session before deleting it');
        changed('sessions', sessions.delete(req.id));
      },
      'sessions:unfinished': () => sessionManager.unfinished(),
      'sessions:resume': async (req) => {
        await check.beforeSessionStart();
        return sessionManager.resume(req.id);
      },
      'sessions:recover': (req) => changed('sessions', sessionManager.recover(req.id)),
      'sessions:discard': (req) => changed('sessions', sessionManager.discard(req.id)),
      'analytics:dashboard': () => {
        const live = sessionManager.activeSessionId ? sessions.get(sessionManager.activeSessionId) : null;
        return analytics.dashboard(live?.assignmentId ?? null);
      },
      'analytics:query': (req) => analytics.query(req),
      'settings:get': () => settings.get(),
      'settings:update': (req) => {
        const next = settings.update(req);
        overlay?.applySettings(next.overlay);
        emit('data:changed', { scope: 'settings' });
        return next;
      },
      'settings:reset': () => {
        const next = settings.reset();
        overlay?.applySettings(next.overlay);
        return next;
      },
      'demo:status': () => ({ hasDemoData: demo.hasDemoData() }),
      'demo:seed': () => {
        demo.seed();
        emit('data:changed', { scope: 'all' });
        return { hasDemoData: demo.hasDemoData() };
      },
      'demo:clear': () => {
        demo.clear();
        emit('data:changed', { scope: 'all' });
        return { hasDemoData: demo.hasDemoData() };
      },
      'displays:list': () => {
        const primaryId = screen.getPrimaryDisplay().id;
        return screen.getAllDisplays().map((d, i) => ({
          id: d.id,
          label: d.label || `Display ${i + 1}`,
          primary: d.id === primaryId,
          bounds: d.bounds,
        }));
      },
      'calibration:start': () => {
        if (check.open) throw new Error('Close the calibration check before calibrating.');
        return calibration.start();
      },
      'calibration:point': (req) => calibration.capturePoint(req.displayId, req.x, req.y),
      'calibration:stop': () => calibration.stop(),
      'calibration:check': () => {
        if (calibration.active) throw new Error('Finish webcam calibration first.');
        check.show();
      },
      'setup:status': () => ({ show: firstRun && settings.getValue('setupCompleted') !== true }),
      'setup:complete': () => settings.setValue('setupCompleted', true),
      'apps:recent': () => sessions.recentApps(40),
      'update:status': () => updates.status,
      // Quitting runs the usual shutdown below; the installer starts once the app has quit.
      'update:install': () => updates.install(),
      'privacy:deleteAll': () => {
        if (sessionManager.activeSessionId) throw new Error('End the running session first');
        db?.exec('DELETE FROM sessions; DELETE FROM assignments;');
        settings.setValue('demoSeeded', true);
        emit('data:changed', { scope: 'all' });
      },
    },
    isMainSender,
  );

  // Camera window channels: accept only derived numbers, and only from the camera window.
  const readModel = async (): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await readFile(modelPath));
    } catch {
      return null;
    }
  };
  ipcMain.handle(CAMERA_CHANNELS.model, (event) => (cameraWindow.isCameraContents(event.sender) ? readModel() : null));
  ipcMain.on(CAMERA_CHANNELS.sample, (event, raw: unknown) => {
    if (!cameraWindow.isCameraContents(event.sender)) return;
    const parsed = cameraSampleSchema.safeParse(raw);
    if (parsed.success) focus.record(parsed.data);
  });
  ipcMain.on(OVERLAY_CHANNELS.resize, (event, raw: unknown) => {
    if (!overlay?.isOverlayContents(event.sender)) return;
    const parsed = overlayResizeSchema.safeParse(raw);
    if (parsed.success) overlay.resize(parsed.data.width, parsed.data.height);
  });
  ipcMain.on(CAMERA_CHANNELS.status, (event, raw: unknown) => {
    if (!cameraWindow.isCameraContents(event.sender)) return;
    const parsed = cameraStatusSchema.safeParse(raw);
    if (!parsed.success) return;
    sessionManager.setCameraStatus(parsed.data.state, parsed.data.message);
    if (calibration.active) calibration.onCameraStatus(parsed.data.state, parsed.data.message);
  });

  // Calibration check window: the same derived numbers, only from that window.
  ipcMain.handle(CHECK_CHANNELS.model, (event) => (check.isCheckContents(event.sender) ? readModel() : null));
  ipcMain.on(CHECK_CHANNELS.sample, (event, raw: unknown) => {
    if (!check.isCheckContents(event.sender)) return;
    const parsed = cameraSampleSchema.safeParse(raw);
    if (parsed.success) check.onSample(parsed.data);
  });
  ipcMain.on(CHECK_CHANNELS.status, (event, raw: unknown) => {
    if (!check.isCheckContents(event.sender)) return;
    const parsed = cameraStatusSchema.safeParse(raw);
    if (parsed.success) check.onCameraStatus(parsed.data.state);
  });

  configurePermissions((wc) => cameraWindow.isCameraContents(wc) || check.isCheckContents(wc));
  app.on('web-contents-created', (_e, contents) => hardenContents(contents));

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
    // The indicator and camera windows must not keep the app alive once the main window closes.
    app.quit();
  });
  tray = new AppTray(() => mainWindow);

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    updates.stop();
    // Keep the session marked active so it can be resumed or recovered on next launch.
    calibration.stop();
    check.close();
    void sessionManager.suspend().finally(() => {
      overlay?.destroy();
      tray?.destroy();
      db?.close();
      app.quit();
    });
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
});

app
  .whenReady()
  .then(bootstrap)
  .catch((err: unknown) => {
    dialog.showErrorBox('FocusProof failed to start', err instanceof Error ? err.message : String(err));
    app.exit(1);
  });
