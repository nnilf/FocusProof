import { app, protocol, net, session, shell, type WebContents } from 'electron';
import { normalize, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rendererDir } from './paths';

export const APP_SCHEME = 'focusproof';
export const APP_ORIGIN = `${APP_SCHEME}://app`;

/** Must run before app "ready". */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
  ]);
}

/**
 * Serves the built renderer from a custom secure origin instead of file://, so fetch() works for
 * the bundled MediaPipe assets and the app gets a stable origin for permission checks.
 */
export function registerAppProtocol(): void {
  const root = rendererDir();
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = normalize(`${root}${pathname}`);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

export function devServerUrl(): string | null {
  return !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null;
}

export function isAppUrl(url: string): boolean {
  const dev = devServerUrl();
  return url.startsWith(APP_ORIGIN) || (dev !== null && url.startsWith(dev));
}

/** Camera access is granted only to the camera and calibration-check windows, and only for video. */
export function configurePermissions(isCameraContents: (wc: WebContents) => boolean): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media' && isCameraContents(wc)) {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      callback(types.every((t) => t === 'video'));
      return;
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'media' && wc !== null && isCameraContents(wc));
}

export function hardenContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}
