import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc/contract';

/** Typed access to the preload bridge. All business logic lives in the main process. */
export function call<C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>> {
  return window.focusproof.invoke(channel, req);
}

export const onEvent = window.focusproof.on.bind(window.focusproof);
