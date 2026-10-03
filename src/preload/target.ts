import { contextBridge, ipcRenderer } from 'electron';
import { TARGET_CHANNELS, type TargetBridge, type TargetPoint } from '../shared/ipc/target';

const bridge: TargetBridge = {
  onPoint: (listener) => {
    ipcRenderer.on(TARGET_CHANNELS.point, (_e, point: TargetPoint) => listener(point));
  },
};

contextBridge.exposeInMainWorld('focusproofTarget', bridge);
