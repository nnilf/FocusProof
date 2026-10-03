import { contextBridge, ipcRenderer } from 'electron';
import { CHECK_CHANNELS, type CheckBridge, type CheckUpdate } from '../shared/ipc/check';

const bridge: CheckBridge = {
  getModel: () => ipcRenderer.invoke(CHECK_CHANNELS.model) as Promise<Uint8Array | null>,
  sendSample: (sample) => ipcRenderer.send(CHECK_CHANNELS.sample, sample),
  sendStatus: (status) => ipcRenderer.send(CHECK_CHANNELS.status, status),
  onUpdate: (listener) => {
    ipcRenderer.on(CHECK_CHANNELS.update, (_e, update: CheckUpdate) => listener(update));
  },
};

contextBridge.exposeInMainWorld('focusproofCheck', bridge);
