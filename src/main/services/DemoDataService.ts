import type { AssignmentInput, SignalFrame, WindowObservation } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { addDays, startOfDay } from '@shared/dates';
import type { Db } from '../db/connection';
import type { AssignmentRepository } from '../db/repositories/assignments';
import type { SessionRepository } from '../db/repositories/sessions';
import type { SettingsRepository } from '../db/repositories/settings';
import { INITIAL_ENGINE_STATE } from '../engine/LearningTimeEngine';
import { WeightedSignalEngine } from '../engine/WeightedSignalEngine';
import type { ReportService } from './ReportService';

/** Deterministic PRNG so demo data looks the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Activity = 'writing' | 'coding' | 'reading' | 'browsing' | 'distracted' | 'away';

interface DemoAssignment {
  input: AssignmentInput;
  file: string;
  kind: 'text' | 'code' | 'docx';
  mainActivity: 'writing' | 'coding';
  archived?: boolean;
}

const DEMO_ASSIGNMENTS: DemoAssignment[] = [
  {
    input: {
      name: 'Literature Review: Urban Heat Islands',
      module: 'GEOG2041',
      description: 'Critical review of mitigation strategies for urban heat islands in temperate cities.',
      deadline: null,
      targetWordCount: 3000,
      currentWordCount: 600,
      estimatedHours: 25,
      notes: 'Focus on green roofs and albedo studies.',
      targets: [{ path: 'C:\\Demo\\GEOG2041\\literature-review.docx', kind: 'file' }],
    },
    file: 'C:\\Demo\\GEOG2041\\literature-review.docx',
    kind: 'docx',
    mainActivity: 'writing',
  },
  {
    input: {
      name: 'Graph Algorithms Coursework',
      module: 'COMP2310',
      description: "Implement and benchmark Dijkstra, A* and Bellman-Ford.",
      deadline: null,
      targetWordCount: null,
      currentWordCount: 0,
      estimatedHours: 18,
      notes: '',
      targets: [{ path: 'C:\\Demo\\COMP2310\\src', kind: 'folder' }],
    },
    file: 'C:\\Demo\\COMP2310\\src\\graph.ts',
    kind: 'code',
    mainActivity: 'coding',
  },
  {
    input: {
      name: 'Reflective Essay',
      module: 'EDUC1102',
      description: 'Reflection on a micro-teaching placement.',
      deadline: null,
      targetWordCount: 1500,
      currentWordCount: 200,
      estimatedHours: 8,
      notes: '',
      targets: [{ path: 'C:\\Demo\\EDUC1102\\reflection.md', kind: 'file' }],
    },
    file: 'C:\\Demo\\EDUC1102\\reflection.md',
    kind: 'text',
    mainActivity: 'writing',
    archived: true,
  },
];

const STEP_MS = 30_000;
const NOTES_WINDOW: WindowObservation = { processName: 'Obsidian', title: 'reflection.md - Obsidian', category: 'productive', relevance: 1, matchedRule: 'app: obsidian' };

const WINDOWS: Record<Activity, WindowObservation[]> = {
  writing: [{ processName: 'WINWORD', title: 'literature-review.docx - Word', category: 'productive', relevance: 1, matchedRule: 'app: winword' }],
  coding: [{ processName: 'Code', title: 'graph.ts - COMP2310 - Visual Studio Code', category: 'productive', relevance: 1, matchedRule: 'app: code' }],
  reading: [
    { processName: 'AcroRd32', title: 'Oke2017_heat_islands.pdf - Adobe Acrobat', category: 'productive', relevance: 1, matchedRule: 'app: acrord32' },
    { processName: 'chrome', title: 'Google Scholar - Google Chrome', category: 'productive', relevance: 0.85, matchedRule: 'title: "scholar"' },
  ],
  browsing: [{ processName: 'chrome', title: 'New Tab - Google Chrome', category: 'neutral', relevance: 0.5, matchedRule: 'browser, no matching rule' }],
  distracted: [
    { processName: 'chrome', title: 'YouTube - Google Chrome', category: 'distracting', relevance: 0, matchedRule: 'title: "youtube"' },
    { processName: 'Discord', title: 'Discord', category: 'distracting', relevance: 0, matchedRule: 'app: discord' },
  ],
  away: [{ processName: 'chrome', title: 'New Tab - Google Chrome', category: 'neutral', relevance: 0.5, matchedRule: null }],
};

/** Seeds realistic history by running the real engine over synthetic signal frames. */
export class DemoDataService {
  constructor(
    private readonly db: Db,
    private readonly assignments: AssignmentRepository,
    private readonly sessions: SessionRepository,
    private readonly settings: SettingsRepository,
    private readonly reports: ReportService,
  ) {}

  hasDemoData(): boolean {
    return this.sessions.hasDemo();
  }

  clear(): void {
    this.db.transaction(() => {
      this.sessions.deleteDemo();
      this.db.prepare('DELETE FROM assignments WHERE is_demo = 1').run();
    })();
  }

  seed(): void {
    if (this.hasDemoData()) return;
    const rand = mulberry32(42);
    const engine = new WeightedSignalEngine();
    const engineSettings = DEFAULT_SETTINGS.engine;
    const today = startOfDay(Date.now());

    this.db.transaction(() => {
      DEMO_ASSIGNMENTS.forEach((demo, idx) => {
        const deadline = demo.archived ? addDays(today, -3) : addDays(today, 10 + idx * 9);
        const assignment = this.assignments.create({ ...demo.input, deadline }, true, addDays(today, -30));
        let words = demo.input.currentWordCount;
        let codeLines = 140;

        const daysBack = demo.archived ? [27, 25, 24, 22, 20] : [20, 18, 16, 13, 11, 9, 7, 5, 4, 2, 1, 0];
        for (const back of daysBack) {
          if (rand() < 0.2 && back !== 0) continue;
          const hour = 9 + Math.floor(rand() * 10);
          const startedAt = addDays(today, -back) + hour * 3_600_000 + Math.floor(rand() * 40) * 60_000;
          if (startedAt > Date.now() - 2 * 3_600_000) continue;
          const steps = Math.floor((35 + rand() * 85) * 2);
          const session = this.sessions.create({
            assignmentId: assignment.id,
            startedAt,
            endedAt: startedAt + steps * STEP_MS,
            status: 'completed',
            isDemo: true,
            engineId: engine.id,
            config: {
              monitoring: { webcam: rand() < 0.3, screenAnalysis: true, activeWindow: true, inputActivity: true, documents: true },
              targets: demo.input.targets,
            },
          });
          const camera = session.config.monitoring.webcam;
          this.sessions.insertSnapshot(session.id, {
            path: demo.file, kind: demo.kind, ts: startedAt, isBaseline: true, sizeBytes: words * 6, mtimeMs: startedAt,
            words: demo.kind === 'code' ? null : words, lines: demo.kind === 'docx' ? null : codeLines,
            wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0,
          });

          let state = INITIAL_ENGINE_STATE;
          let activity: Activity = demo.mainActivity;
          let lastEdit: number | null = null;
          let idle = 0;
          const focusBias = 0.55 + rand() * 0.35;
          for (let i = 0; i < steps; i++) {
            activity = this.nextActivity(activity, demo.mainActivity, focusBias, rand);
            const startTs = startedAt + i * STEP_MS;
            const endTs = startTs + STEP_MS;
            const editing = activity === 'writing' || activity === 'coding';
            const active = activity !== 'away' && activity !== 'reading';
            idle = active ? Math.floor(rand() * 3000) : idle + STEP_MS;
            let added = 0;
            let removed = 0;
            if (editing && rand() < 0.75) {
              added = demo.kind === 'code' ? Math.floor(rand() * 12) : Math.floor(rand() * 28);
              removed = Math.floor(added * rand() * 0.35);
              lastEdit = endTs;
            }
            const frame: SignalFrame = {
              startTs,
              endTs,
              window: activity === 'writing' && demo.kind === 'text' ? NOTES_WINDOW : this.pick(WINDOWS[activity], rand),
              input: active
                ? { keyboardEvents: editing ? 40 + Math.floor(rand() * 60) : 5, mouseEvents: 10 + Math.floor(rand() * 30), activeSeconds: editing ? 20 + Math.floor(rand() * 10) : 8 + Math.floor(rand() * 10), idleMs: idle }
                : { keyboardEvents: 0, mouseEvents: activity === 'reading' ? Math.floor(rand() * 4) : 0, activeSeconds: activity === 'reading' ? Math.floor(rand() * 4) : 0, idleMs: activity === 'reading' ? Math.floor(rand() * 40_000) : idle },
              screen: { analyzerId: 'rules-v1', relevance: activity === 'distracted' ? 0 : editing ? 1 : null, visualChange: activity === 'away' ? 0 : rand() * 0.4, note: null },
              camera: camera
                ? { samples: 60, presence: activity === 'away' ? 0 : 0.9 + rand() * 0.1, focus: activity === 'distracted' ? 0.5 + rand() * 0.3 : 0.7 + rand() * 0.3, lookingAwayMs: 0 }
                : null,
              documents: {
                changeEvents: added + removed > 0 ? 1 : 0,
                msSinceLastChange: lastEdit === null ? null : endTs - lastEdit,
                wordsAdded: demo.kind === 'code' ? 0 : added,
                wordsRemoved: demo.kind === 'code' ? 0 : removed,
                linesAdded: demo.kind === 'code' ? added : added > 0 ? 1 : 0,
                linesRemoved: demo.kind === 'code' ? removed : 0,
                filesChanged: added + removed > 0 ? [demo.file] : [],
              },
            };
            const result = engine.evaluate(frame, state, engineSettings);
            state = result.state;
            this.sessions.insertInterval(session.id, frame, result.evaluation, { storeTitle: true });
            if (added + removed > 0) {
              if (demo.kind === 'code') codeLines += added - removed;
              else words += added - removed;
              this.sessions.insertSnapshot(session.id, {
                path: demo.file, kind: demo.kind, ts: endTs, isBaseline: false, sizeBytes: words * 6, mtimeMs: endTs,
                words: demo.kind === 'code' ? null : words, lines: demo.kind === 'docx' ? null : codeLines,
                wordsAdded: demo.kind === 'code' ? 0 : added, wordsRemoved: demo.kind === 'code' ? 0 : removed,
                linesAdded: demo.kind === 'code' ? added : 1, linesRemoved: demo.kind === 'code' ? removed : 0,
              });
            }
          }
          this.reports.computeMetrics(session.id, startedAt + steps * STEP_MS);
        }
        this.assignments.setCurrentWords(assignment.id, words);
        if (demo.archived) this.assignments.setArchived(assignment.id, true);
      });
    })();
    this.settings.setValue('demoSeeded', true);
  }

  private pick<T>(list: T[], rand: () => number): T {
    const item = list[Math.floor(rand() * list.length)] ?? list[0];
    if (item === undefined) throw new Error('empty list');
    return item;
  }

  private nextActivity(current: Activity, main: 'writing' | 'coding', focus: number, rand: () => number): Activity {
    const r = rand();
    const stay = current === 'away' ? 0.75 : current === 'distracted' ? 0.6 : 0.85;
    if (r < stay) return current;
    const x = rand();
    if (x < focus * 0.6) return main;
    if (x < focus * 0.6 + 0.2) return 'reading';
    if (x < focus * 0.6 + 0.3) return 'browsing';
    if (x < 0.93) return 'distracted';
    return 'away';
  }
}
