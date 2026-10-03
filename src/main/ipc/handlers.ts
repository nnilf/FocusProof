import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { IpcChannel, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc/contract';
import {
  analyticsQuerySchema,
  archiveSchema,
  assignmentInputSchema,
  calibrationCaptureSchema,
  emptySchema,
  idSchema,
  listAssignmentsSchema,
  listSessionsSchema,
  pickPathsSchema,
  settingsPatchSchema,
  startSessionSchema,
  updateAssignmentSchema,
} from '@shared/ipc/schemas';

type Handler<C extends IpcChannel> = (req: IpcRequest<C>, event: IpcMainInvokeEvent) => IpcResponse<C> | Promise<IpcResponse<C>>;

export type HandlerMap = { [C in IpcChannel]: Handler<C> };

/** Request validators per channel. Every channel must have one. */
const SCHEMAS: { [C in IpcChannel]: z.ZodType } = {
  'app:info': emptySchema,
  'assignments:list': listAssignmentsSchema,
  'assignments:get': idSchema,
  'assignments:create': assignmentInputSchema,
  'assignments:update': updateAssignmentSchema,
  'assignments:archive': archiveSchema,
  'assignments:delete': idSchema,
  'assignments:stats': idSchema,
  'dialog:pickPaths': pickPathsSchema,
  'sessions:start': startSessionSchema,
  'sessions:end': emptySchema,
  'sessions:live': emptySchema,
  'sessions:list': listSessionsSchema,
  'sessions:report': idSchema,
  'sessions:day': emptySchema,
  'sessions:delete': idSchema,
  'sessions:unfinished': emptySchema,
  'sessions:resume': idSchema,
  'sessions:recover': idSchema,
  'sessions:discard': idSchema,
  'analytics:dashboard': emptySchema,
  'analytics:query': analyticsQuerySchema,
  'settings:get': emptySchema,
  'settings:update': settingsPatchSchema,
  'settings:reset': emptySchema,
  'demo:status': emptySchema,
  'demo:seed': emptySchema,
  'demo:clear': emptySchema,
  'privacy:deleteAll': emptySchema,
  'displays:list': emptySchema,
  'calibration:start': emptySchema,
  'calibration:capture': calibrationCaptureSchema,
  'calibration:stop': emptySchema,
};

export function registerHandlers(handlers: HandlerMap, isTrustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  for (const channel of Object.keys(SCHEMAS) as IpcChannel[]) {
    const schema = SCHEMAS[channel];
    const handler = handlers[channel] as Handler<IpcChannel>;
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted sender' };
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) {
        return { ok: false, error: `Invalid request for ${channel}: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
      }
      try {
        const data = await handler(parsed.data as IpcRequest<IpcChannel>, event);
        return { ok: true, data };
      } catch (err) {
        console.error(`[ipc] ${channel} failed`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }
}
