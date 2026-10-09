import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@shared/ipc/contract';
import { UpdateService, type Updater } from '../../src/main/services/UpdateService';

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(() => Promise.resolve(null));
  quitAndInstall = vi.fn();
}

function setup(opts: { packaged?: boolean; session?: boolean } = {}) {
  const updater = new FakeUpdater();
  const statuses: UpdateStatus[] = [];
  const service = new UpdateService({
    updater: opts.packaged === false ? null : updater,
    isSessionRunning: () => opts.session ?? false,
    onStatus: (s) => statuses.push(s),
  });
  return { updater, service, statuses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateService', () => {
  it('downloads in the background and installs on quit', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('follows the updater through a download', () => {
    const { updater, service, statuses } = setup();
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.3.2' });
    updater.emit('update-downloaded', { version: '0.3.2' });
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'downloading', 'ready']);
    expect(service.status).toEqual({ state: 'ready', version: '0.3.2' });
  });

  it('keeps a downloaded update installable after a failed check', () => {
    const { updater, service } = setup();
    updater.emit('update-downloaded', { version: '0.3.2' });
    updater.emit('error', new Error('offline'));
    expect(service.status.state).toBe('ready');
  });

  it('does not restart during a session', () => {
    const { updater, service } = setup({ session: true });
    updater.emit('update-downloaded', { version: '0.3.2' });
    expect(() => service.install()).toThrow('End the session before updating.');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs silently and relaunches when asked', () => {
    const { updater, service } = setup();
    updater.emit('update-downloaded', { version: '0.3.2' });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('checks shortly after start, but not outside an installed build', () => {
    vi.useFakeTimers();
    const packaged = setup();
    packaged.service.start();
    vi.advanceTimersByTime(10_000);
    expect(packaged.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    packaged.service.stop();

    const dev = setup({ packaged: false });
    dev.service.start();
    vi.advanceTimersByTime(10_000);
    expect(dev.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(dev.service.status.state).toBe('unavailable');
  });
});
