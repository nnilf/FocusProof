import { app } from 'electron';
import { join } from 'node:path';

/** Location of bundled resources (models, helper scripts) in dev and packaged builds. */
export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, ...parts);
}

export const rendererDir = (): string => join(__dirname, '../renderer');
export const preloadPath = (name: 'index' | 'camera'): string => join(__dirname, `../preload/${name}.js`);
