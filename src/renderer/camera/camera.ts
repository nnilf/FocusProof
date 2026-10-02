import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { CameraBridge, CameraConfig } from '@shared/ipc/camera';

declare global {
  interface Window {
    focusproofCamera: CameraBridge;
  }
}

const bridge = window.focusproofCamera;
const video = document.getElementById('video') as HTMLVideoElement;
let started = false;

const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Head yaw/pitch from MediaPipe's 4x4 column-major facial transformation matrix. */
function headPose(m: ArrayLike<number>): { yawDeg: number; pitchDeg: number } {
  const r20 = m[2] ?? 0;
  const r21 = m[6] ?? 0;
  const r22 = m[10] ?? 1;
  return {
    yawDeg: toDeg(Math.asin(Math.max(-1, Math.min(1, -r20)))),
    pitchDeg: toDeg(Math.atan2(r21, r22)),
  };
}

async function start(config: CameraConfig): Promise<void> {
  if (started) return;
  started = true;
  bridge.sendStatus({ state: 'starting', message: null });
  try {
    const model = await bridge.getModel();
    if (!model) throw new Error('Face model not installed. Run "npm run fetch-models".');
    const fileset = await FilesetResolver.forVisionTasks(new URL('./mediapipe', window.location.href).href);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 15 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    bridge.sendStatus({ state: 'active', message: null });

    const periodMs = 1000 / Math.max(0.2, config.samplesPerSecond);
    window.setInterval(() => {
      if (video.readyState < 2) return;
      const result = landmarker.detectForVideo(video, performance.now());
      const matrix = result.facialTransformationMatrixes?.[0]?.data;
      const facePresent = (result.faceLandmarks?.length ?? 0) > 0;
      const pose = facePresent && matrix ? headPose(matrix) : null;
      bridge.sendSample({
        ts: Date.now(),
        facePresent,
        yawDeg: pose?.yawDeg ?? null,
        pitchDeg: pose?.pitchDeg ?? null,
      });
    }, periodMs);
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Camera permission was denied'
        : err instanceof DOMException && err.name === 'NotFoundError'
          ? 'No camera found'
          : err instanceof Error
            ? err.message
            : String(err);
    bridge.sendStatus({ state: 'unavailable', message });
  }
}

bridge.onConfig((config) => void start(config));
