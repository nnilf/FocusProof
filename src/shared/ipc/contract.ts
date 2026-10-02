import type {
  AnalyticsData,
  AnalyticsQuery,
  FocusZone,
  Assignment,
  AssignmentInput,
  AssignmentStats,
  DashboardData,
  LiveStatus,
  SessionReport,
  SessionSummaryRow,
  Settings,
  SettingsPatch,
  StartSessionInput,
  UnfinishedSession,
} from '../types';

export interface AppInfo {
  version: string;
  platform: string;
  dataPath: string;
  capabilities: {
    activeWindow: boolean;
    cameraModel: boolean;
  };
}

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  /** Position and size in desktop coordinates (DIP), as arranged in Windows display settings. */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface DemoStatus {
  hasDemoData: boolean;
}

/** Request/response types for every invoke channel. Requests are validated with zod in main. */
export interface IpcContract {
  'app:info': { req: Record<string, never>; res: AppInfo };
  'assignments:list': { req: { includeArchived: boolean }; res: Assignment[] };
  'assignments:get': { req: { id: number }; res: Assignment | null };
  'assignments:create': { req: AssignmentInput; res: Assignment };
  'assignments:update': { req: { id: number; input: AssignmentInput }; res: Assignment };
  'assignments:archive': { req: { id: number; archived: boolean }; res: Assignment };
  'assignments:delete': { req: { id: number }; res: void };
  'assignments:stats': { req: { id: number }; res: AssignmentStats };
  'dialog:pickPaths': { req: { folders: boolean }; res: string[] };
  'sessions:start': { req: StartSessionInput; res: LiveStatus };
  'sessions:end': { req: Record<string, never>; res: { sessionId: number } };
  'sessions:live': { req: Record<string, never>; res: LiveStatus | null };
  'sessions:list': { req: { assignmentId: number | null; limit: number }; res: SessionSummaryRow[] };
  'sessions:report': { req: { id: number }; res: SessionReport | null };
  'sessions:delete': { req: { id: number }; res: void };
  'sessions:unfinished': { req: Record<string, never>; res: UnfinishedSession[] };
  'sessions:resume': { req: { id: number }; res: LiveStatus };
  'sessions:recover': { req: { id: number }; res: { sessionId: number } };
  'sessions:discard': { req: { id: number }; res: void };
  'analytics:dashboard': { req: Record<string, never>; res: DashboardData };
  'analytics:query': { req: AnalyticsQuery; res: AnalyticsData };
  'settings:get': { req: Record<string, never>; res: Settings };
  'settings:update': { req: SettingsPatch; res: Settings };
  'settings:reset': { req: Record<string, never>; res: Settings };
  'demo:status': { req: Record<string, never>; res: DemoStatus };
  'demo:seed': { req: Record<string, never>; res: DemoStatus };
  'demo:clear': { req: Record<string, never>; res: DemoStatus };
  'privacy:deleteAll': { req: Record<string, never>; res: void };
  'displays:list': { req: Record<string, never>; res: DisplayInfo[] };
  'calibration:start': { req: Record<string, never>; res: void };
  'calibration:capture': {
    req: { kind: FocusZone['kind']; displayId: number | null; label: string };
    res: FocusZone & { samples: number };
  };
  'calibration:stop': { req: Record<string, never>; res: void };
}

export type IpcChannel = keyof IpcContract;
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req'];
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res'];

/** Events pushed from main to the renderer. */
export interface IpcEvents {
  'session:live': LiveStatus | null;
  'session:ended': { sessionId: number };
  'data:changed': { scope: 'assignments' | 'sessions' | 'settings' | 'all' };
}
export type IpcEventName = keyof IpcEvents;
export const IPC_EVENT_NAMES: readonly IpcEventName[] = ['session:live', 'session:ended', 'data:changed'];

/** Result envelope so errors cross the bridge with a readable message instead of a stack trace. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface FocusProofBridge {
  invoke<C extends IpcChannel>(channel: C, req: IpcRequest<C>): Promise<IpcResponse<C>>;
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
}
