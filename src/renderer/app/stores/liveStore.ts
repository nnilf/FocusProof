import { create } from 'zustand';
import type { LiveStatus } from '@shared/types';
import { call, onEvent } from '../lib/api';

interface LiveStore {
  status: LiveStatus | null;
  /** Locally ticking clock so the elapsed timer updates smoothly between analysis intervals. */
  now: number;
  init: () => () => void;
}

export const useLiveStore = create<LiveStore>((set) => ({
  status: null,
  now: Date.now(),
  init: () => {
    void call('sessions:live', {}).then((status) => set({ status }));
    const off = onEvent('session:live', (status) => set({ status }));
    const timer = window.setInterval(() => set({ now: Date.now() }), 1000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  },
}));
