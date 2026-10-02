// Downloads the MediaPipe face landmarker model once at install time and copies the
// MediaPipe WASM runtime next to it, so webcam analysis runs fully offline at runtime.
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = join(root, 'resources', 'models');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
// WASM is served by the renderer (same origin in dev and production); the model is read by main.
const wasmDest = join(root, 'src', 'renderer', 'public', 'mediapipe');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const modelPath = join(modelsDir, 'face_landmarker.task');

mkdirSync(modelsDir, { recursive: true });

if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, wasmDest, { recursive: true });
  console.log('[fetch-models] MediaPipe WASM copied');
} else {
  console.warn('[fetch-models] @mediapipe/tasks-vision not installed; webcam analysis unavailable');
}

if (existsSync(modelPath)) {
  console.log('[fetch-models] face_landmarker.task already present');
} else {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('[fetch-models] face_landmarker.task downloaded');
  } catch (err) {
    // Non-fatal: the app runs without webcam analysis and reports the camera as unavailable.
    console.warn(`[fetch-models] Could not download model (${String(err)}). Run "npm run fetch-models" later.`);
  }
}
