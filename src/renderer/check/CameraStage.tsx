import { useEffect, useRef, type RefObject } from 'react';
import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Track } from './faceTracker';

const NOSE_TIP = 1;
const FEATURES = [
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
];
const IRISES = [FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS];

type Connections = { start: number; end: number }[];

function strokeConnections(ctx: CanvasRenderingContext2D, pts: NormalizedLandmark[], conns: Connections, w: number, h: number): void {
  ctx.beginPath();
  for (const c of conns) {
    const a = pts[c.start];
    const b = pts[c.end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
  }
  ctx.stroke();
}

/** Focus-style corner brackets around the face. */
function brackets(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.min(x1 - x0, y1 - y0) * 0.16;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.moveTo(x + dx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * len);
  }
  ctx.stroke();
}

function draw(canvas: HTMLCanvasElement, track: Track | null, color: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const pts = track?.landmarks;
  if (!pts) return;
  const unit = w / 640;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    const p = pts[c.start];
    if (!p) continue;
    x0 = Math.min(x0, p.x * w);
    x1 = Math.max(x1, p.x * w);
    y0 = Math.min(y0, p.y * h);
    y1 = Math.max(y1, p.y * h);
  }
  const pad = (x1 - x0) * 0.12;

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.4 * unit;
  strokeConnections(ctx, pts, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1 * unit;
  for (const f of FEATURES) strokeConnections(ctx, pts, f, w, h);

  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * unit;
  brackets(ctx, x0 - pad, y0 - pad, x1 + pad, y1 + pad);

  ctx.fillStyle = color;
  for (const iris of IRISES) {
    let cx = 0;
    let cy = 0;
    for (const c of iris) {
      cx += (pts[c.start]?.x ?? 0) / iris.length;
      cy += (pts[c.start]?.y ?? 0) / iris.length;
    }
    ctx.beginPath();
    ctx.arc(cx * w, cy * h, 2.6 * unit, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head direction: the face's forward axis, projected onto the image from the nose tip.
  const nose = pts[NOSE_TIP];
  if (nose && track.yawDeg !== null && track.pitchDeg !== null) {
    const yaw = (track.yawDeg * Math.PI) / 180;
    const pitch = (track.pitchDeg * Math.PI) / 180;
    const len = (x1 - x0) * 1.6;
    const sx = nose.x * w;
    const sy = nose.y * h;
    const ex = sx + Math.sin(yaw) * Math.cos(pitch) * len;
    const ey = sy + Math.sin(pitch) * len;
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, color);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 * unit;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ex, ey, 6 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5 * unit;
    ctx.stroke();
  }
}

/** Mirrored webcam view with the face outline and head direction drawn on top. */
export function CameraStage(props: {
  videoRef: RefObject<HTMLVideoElement | null>;
  trackRef: RefObject<Track | null>;
  color: string;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(props.color);
  useEffect(() => {
    colorRef.current = props.color;
  }, [props.color]);
  const { videoRef, trackRef } = props;

  useEffect(() => {
    let raf = 0;
    let drawnTs = -1;
    const loop = (): void => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const track = trackRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      // Twice the video resolution keeps the lines crisp; same aspect, so both crop alike.
      if (canvas.width !== video.videoWidth * 2) {
        canvas.width = video.videoWidth * 2;
        canvas.height = video.videoHeight * 2;
        drawnTs = -1;
      }
      if (track?.ts === drawnTs) return;
      drawnTs = track?.ts ?? -1;
      draw(canvas, track, colorRef.current);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [videoRef, trackRef]);

  return (
    <div className="stage">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} aria-hidden />
      {props.children}
    </div>
  );
}
