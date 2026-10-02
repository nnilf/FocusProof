import { contextBridge, ipcRenderer } from 'electron';
import { OVERLAY_CHANNELS, type OverlayBridge, type OverlayState } from '../shared/ipc/overlay';

const bridge: OverlayBridge = {
  onState: (listener) => {
    ipcRenderer.on(OVERLAY_CHANNELS.state, (_e, state: OverlayState) => listener(state));
  },
  resize: (width, height) => ipcRenderer.send(OVERLAY_CHANNELS.resize, { width, height }),
};

contextBridge.exposeInMainWorld('focusproofOverlay', bridge);
