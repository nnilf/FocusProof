import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { eyeDirection, headPose } from '@shared/focus/gaze';
import type { CheckBridge } from '@shared/ipc/check';

export interface Track {
  ts: number;
  /** Normalised to the unmirrored video frame; null when no face is detected. */
  landmarks: NormalizedLandmark[] | null;
  yawDeg: number | null;
  pitchDeg: number | null;
  eyeX: number | null;
  eyeY: number | null;
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Camera permission was denied';
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No camera found';
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs face landmarks on every new video frame for drawing, and reports derived samples (never
 * frames) to main at the configured rate, exactly as the session's camera window does.
 */
export async function startTracker(
  bridge: CheckBridge,
  video: HTMLVideoElement,
  samplesPerSecond: () => number,
  onTrack: (track: Track) => void,
): Promise<() => void> {
  bridge.sendStatus({ state: 'starting', message: null });
  let stream: MediaStream | null = null;
  try {
    const model = await bridge.getModel();
    if (!model) throw new Error('Face model not installed. Run "npm run fetch-models".');
    const fileset = await FilesetResolver.forVisionTasks(new URL('./mediapipe', window.location.href).href);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: true,
    });
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
    video.srcObject = stream;
    await video.play();
    bridge.sendStatus({ state: 'active', message: null });

    let raf = 0;
    let lastVideoTime = -1;
    let lastSampleTs = 0;
    const loop = (): void => {
      raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      const landmarks = result.faceLandmarks?.[0] ?? null;
      const matrix = result.facialTransformationMatrixes?.[0]?.data;
      const pose = landmarks && matrix ? headPose(matrix) : null;
      const eye = pose ? eyeDirection(result.faceBlendshapes?.[0]?.categories) : null;
      const track: Track = {
        ts: Date.now(),
        landmarks,
        yawDeg: pose?.yawDeg ?? null,
        pitchDeg: pose?.pitchDeg ?? null,
        eyeX: eye?.eyeX ?? null,
        eyeY: eye?.eyeY ?? null,
      };
      onTrack(track);
      if (track.ts - lastSampleTs >= 1000 / Math.max(0.2, samplesPerSecond())) {
        lastSampleTs = track.ts;
        bridge.sendSample({
          ts: track.ts,
          facePresent: landmarks !== null,
          yawDeg: track.yawDeg,
          pitchDeg: track.pitchDeg,
          eyeX: track.eyeX,
          eyeY: track.eyeY,
        });
      }
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker.close();
    };
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    const message = describe(err);
    bridge.sendStatus({ state: 'unavailable', message });
    throw new Error(message);
  }
}
