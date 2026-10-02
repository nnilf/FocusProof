import { stat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { DocumentKind, DocumentObservation, SessionTarget } from '@shared/types';
import { computeTextDelta, countLines, countWords, documentKind, isSupportedDocument, type TextDelta } from './textMetrics';
import { extractText } from './extractors';

export interface DocumentChangeRecord extends TextDelta {
  path: string;
  kind: DocumentKind;
  ts: number;
  isBaseline: boolean;
  sizeBytes: number;
  mtimeMs: number;
  words: number | null;
  lines: number | null;
}

export interface DocumentAnalyzerOptions {
  targets: SessionTarget[];
  /** Paths that already have a baseline in storage (used when resuming a session). */
  knownPaths?: ReadonlySet<string>;
  onRecord: (record: DocumentChangeRecord) => void;
  onError?: (message: string) => void;
}

/**
 * Watches assignment files and turns raw file changes into progress metrics. Implementations
 * must never persist document content; only derived numbers leave the analyzer.
 */
export interface DocumentActivityAnalyzer {
  start(options: DocumentAnalyzerOptions): Promise<void>;
  /** Activity since the previous drain. */
  drain(now: number): DocumentObservation;
  stop(): Promise<void>;
  readonly fileCount: number;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv', '.next', 'target', 'bin', 'obj']);
const MAX_CACHED_BYTES = 2_000_000;
const MAX_FILES = 3_000;

interface FileState {
  kind: DocumentKind;
  content: string | null;
  words: number | null;
  lines: number | null;
}

export class FileSystemDocumentAnalyzer implements DocumentActivityAnalyzer {
  private watcher: FSWatcher | null = null;
  private readonly files = new Map<string, FileState>();
  private readonly queues = new Map<string, Promise<void>>();
  private options: DocumentAnalyzerOptions | null = null;
  private window: Omit<DocumentObservation, 'msSinceLastChange' | 'filesChanged'> & { files: Set<string> } =
    this.emptyWindow();
  private lastChangeTs: number | null = null;

  get fileCount(): number {
    return this.files.size;
  }

  async start(options: DocumentAnalyzerOptions): Promise<void> {
    this.options = options;
    if (options.targets.length === 0) return;
    const watcher = watch(
      options.targets.map((t) => t.path),
      {
        persistent: true,
        ignoreInitial: false,
        depth: 6,
        awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
        ignored: (path, stats) => {
          const name = basename(path);
          if (IGNORED_DIRS.has(name) || name.startsWith('~$') || name.startsWith('.~')) return true;
          return Boolean(stats?.isFile()) && !isSupportedDocument(path);
        },
      },
    );
    this.watcher = watcher;
    let ready = false;
    watcher.on('add', (path) => this.enqueue(path, ready ? 'change' : 'initial'));
    watcher.on('change', (path) => this.enqueue(path, 'change'));
    watcher.on('unlink', (path) => this.files.delete(path));
    watcher.on('error', (err) => options.onError?.(`Document watcher error: ${String(err)}`));
    await new Promise<void>((resolve) => {
      watcher.once('ready', () => {
        ready = true;
        resolve();
      });
    });
    await Promise.all(this.queues.values());
  }

  drain(now: number): DocumentObservation {
    const w = this.window;
    this.window = this.emptyWindow();
    return {
      changeEvents: w.changeEvents,
      wordsAdded: w.wordsAdded,
      wordsRemoved: w.wordsRemoved,
      linesAdded: w.linesAdded,
      linesRemoved: w.linesRemoved,
      filesChanged: [...w.files],
      msSinceLastChange: this.lastChangeTs === null ? null : Math.max(0, now - this.lastChangeTs),
    };
  }

  async stop(): Promise<void> {
    await Promise.all(this.queues.values());
    await this.watcher?.close();
    this.watcher = null;
    this.files.clear();
  }

  private emptyWindow(): Omit<DocumentObservation, 'msSinceLastChange' | 'filesChanged'> & { files: Set<string> } {
    return { changeEvents: 0, wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0, files: new Set() };
  }

  /** Changes to the same file are processed sequentially so diffs never interleave. */
  private enqueue(path: string, mode: 'initial' | 'change'): void {
    const prev = this.queues.get(path) ?? Promise.resolve();
    const next = prev
      .then(() => this.process(path, mode))
      .catch((err: unknown) => this.options?.onError?.(`Could not analyse ${basename(path)}: ${String(err)}`));
    this.queues.set(path, next);
  }

  private async process(path: string, mode: 'initial' | 'change'): Promise<void> {
    if (!this.files.has(path) && this.files.size >= MAX_FILES) return;
    const info = await stat(path);
    const kind = documentKind(path);
    const content = await this.readContent(path, kind, info.size);
    const words = content !== null && kind !== 'code' ? countWords(content) : null;
    const lines = content !== null && kind !== 'docx' ? countLines(content) : null;
    const prev = this.files.get(path);
    this.files.set(path, { kind, content: content !== null && content.length <= MAX_CACHED_BYTES ? content : null, words, lines });

    const isInitial = mode === 'initial' || !prev;
    if (isInitial) {
      if (mode === 'initial' && this.options?.knownPaths?.has(path)) return;
      // A file created during the session starts from an empty baseline so its words count as progress.
      const created = mode === 'change';
      this.options?.onRecord({
        path, kind, ts: Date.now(), isBaseline: true,
        sizeBytes: created ? 0 : info.size, mtimeMs: info.mtimeMs,
        words: created && words !== null ? 0 : words, lines: created && lines !== null ? 0 : lines,
        wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0,
      });
      if (!created) return;
    }

    const delta = this.delta(prev, content, words, lines);
    if (prev && delta.wordsAdded + delta.wordsRemoved + delta.linesAdded + delta.linesRemoved === 0 && prev.content === content) {
      return; // Saved without changes (e.g. editor autosave touching mtime).
    }
    const now = Date.now();
    this.lastChangeTs = now;
    this.window.changeEvents += 1;
    this.window.wordsAdded += delta.wordsAdded;
    this.window.wordsRemoved += delta.wordsRemoved;
    this.window.linesAdded += delta.linesAdded;
    this.window.linesRemoved += delta.linesRemoved;
    this.window.files.add(path);
    this.options?.onRecord({
      path, kind, ts: now, isBaseline: false, sizeBytes: info.size, mtimeMs: info.mtimeMs, words, lines, ...delta,
    });
  }

  private delta(prev: FileState | undefined, content: string | null, words: number | null, lines: number | null): TextDelta {
    if (prev?.content != null && content !== null) {
      const d = computeTextDelta(prev.content, content);
      return prev.kind === 'code' ? { ...d, wordsAdded: 0, wordsRemoved: 0 } : d;
    }
    // Content too large to cache: fall back to count differences.
    const dw = (words ?? 0) - (prev?.words ?? 0);
    const dl = (lines ?? 0) - (prev?.lines ?? 0);
    return {
      wordsAdded: Math.max(0, dw),
      wordsRemoved: Math.max(0, -dw),
      linesAdded: Math.max(0, dl),
      linesRemoved: Math.max(0, -dl),
    };
  }

  private async readContent(path: string, kind: DocumentKind, size: number): Promise<string | null> {
    if (size > MAX_CACHED_BYTES * 4) return null;
    if (kind === 'docx') return extractText(path);
    return readFile(path, 'utf8');
  }
}
