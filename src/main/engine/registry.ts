import type { LearningTimeEngine } from './LearningTimeEngine';
import { WeightedSignalEngine } from './WeightedSignalEngine';

const engines = new Map<string, () => LearningTimeEngine>([['weighted-v1', () => new WeightedSignalEngine()]]);

export const DEFAULT_ENGINE_ID = 'weighted-v1';

/** Register an alternative algorithm; sessions record which engine produced their intervals. */
export function registerEngine(id: string, factory: () => LearningTimeEngine): void {
  engines.set(id, factory);
}

export function createEngine(id: string = DEFAULT_ENGINE_ID): LearningTimeEngine {
  const factory = engines.get(id) ?? engines.get(DEFAULT_ENGINE_ID);
  if (!factory) throw new Error('No learning time engine registered');
  return factory();
}
