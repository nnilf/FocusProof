import { contextBridge, ipcRenderer } from 'electron';
import { CAMERA_CHANNELS, type CameraBridge, type CameraConfig } from '../shared/ipc/camera';

const bridge: CameraBridge = {
  getModel: () => ipcRenderer.invoke(CAMERA_CHANNELS.model) as Promise<Uint8Array | null>,
  sendSample: (sample) => ipcRenderer.send(CAMERA_CHANNELS.sample, sample),
  sendStatus: (status) => ipcRenderer.send(CAMERA_CHANNELS.status, status),
  onConfig: (listener) => {
    ipcRenderer.on(CAMERA_CHANNELS.config, (_e, config: CameraConfig) => listener(config));
  },
};

contextBridge.exposeInMainWorld('focusproofCamera', bridge);
