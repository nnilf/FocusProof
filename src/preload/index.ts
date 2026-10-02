import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_EVENT_NAMES,
  type IpcChannel,
  type IpcEventName,
  type IpcEvents,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
  type FocusProofBridge,
} from '../shared/ipc/contract';

const bridge: FocusProofBridge = {
  async invoke<C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>> {
    const result = (await ipcRenderer.invoke(channel, req)) as IpcResult<IpcResponse<C>>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
    if (!IPC_EVENT_NAMES.includes(event)) throw new Error(`Unknown event ${event}`);
    const wrapped = (_e: IpcRendererEvent, payload: IpcEvents[E]): void => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
};

contextBridge.exposeInMainWorld('focusproof', bridge);
