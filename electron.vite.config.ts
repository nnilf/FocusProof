import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, 'src/shared');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          camera: resolve(__dirname, 'src/preload/camera.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
          check: resolve(__dirname, 'src/preload/check.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer/app') },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          camera: resolve(__dirname, 'src/renderer/camera.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          check: resolve(__dirname, 'src/renderer/check.html'),
        },
      },
    },
  },
});
