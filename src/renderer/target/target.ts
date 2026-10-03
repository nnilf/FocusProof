import type { TargetBridge } from '@shared/ipc/target';
import './target.css';

declare global {
  interface Window {
    focusproofTarget: TargetBridge;
  }
}

const target = document.getElementById('target') as HTMLDivElement;

window.focusproofTarget.onPoint((point) => {
  target.hidden = false;
  target.style.left = `${point.x * 100}%`;
  target.style.top = `${point.y * 100}%`;
  target.className = '';
  // Restart the closing ring for every new point.
  void target.offsetWidth;
  target.className = point.phase;
});
