import './overlay.css';
import type { OverlayBridge, OverlayState } from '@shared/ipc/overlay';

declare global {
  interface Window {
    focusproofOverlay: OverlayBridge;
  }
}

const LABEL = { productive: 'Productive', neutral: 'Neutral', distracted: 'Distracted', away: 'Away' } as const;
const DOT_PX = { small: 10, medium: 14 } as const;
const CAMERA_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';

const bridge = window.focusproofOverlay;
const root = document.getElementById('indicator') as HTMLDivElement;

function formatAlt(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  return h > 0 ? `${h}h ${String(totalMin % 60).padStart(2, '0')}m` : `${totalMin}m`;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function render(state: OverlayState): void {
  const { details } = state;
  root.replaceChildren();
  root.style.setProperty('--dot', `${DOT_PX[state.size]}px`);

  const dot = document.createElement('span');
  dot.className = `dot ${state.classification ?? 'idle'}`;
  root.append(dot);
  root.title = state.classification ? LABEL[state.classification] : 'FocusProof';

  if (details.label) root.append(span('text', state.classification ? LABEL[state.classification] : 'Waiting'));
  if (details.focusScore && state.focusScore !== null) root.append(span('text muted', state.focusScore.toFixed(2)));
  if (details.alt) root.append(span('text muted', formatAlt(state.altMs)));
  if (details.camera && state.cameraOn) {
    const cam = document.createElement('span');
    cam.className = 'camera';
    cam.innerHTML = CAMERA_SVG;
    root.append(cam);
  }

  root.classList.toggle('pill', root.childElementCount > 1);
  const rect = root.getBoundingClientRect();
  bridge.resize(Math.ceil(rect.width), Math.ceil(rect.height));
}

bridge.onState(render);
