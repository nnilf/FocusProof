/// <reference types="vite/client" />
import type { FocusProofBridge } from '@shared/ipc/contract';

declare global {
  interface Window {
    focusproof: FocusProofBridge;
  }
}

export {};
