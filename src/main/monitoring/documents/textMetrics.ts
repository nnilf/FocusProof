import { diffLines, diffWords } from 'diff';
import type { DocumentKind } from '@shared/types';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rst', '.tex', '.org', '.adoc']);
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.scala', '.m', '.r', '.sql', '.html', '.css',
  '.scss', '.less', '.vue', '.svelte', '.json', '.yaml', '.yml', '.toml', '.xml', '.sh', '.ps1', '.bat',
  '.lua', '.dart', '.hs', '.ml', '.fs', '.jl', '.ipynb',
]);

export function documentKind(path: string): DocumentKind {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  if (ext === '.docx') return 'docx';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'other';
}

export const isSupportedDocument = (path: string): boolean => documentKind(path) !== 'other';

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const n = text.split(/\r\n|\r|\n/).length;
  return /(\r\n|\r|\n)$/.test(text) ? n - 1 : n;
}

export interface TextDelta {
  wordsAdded: number;
  wordsRemoved: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Line diff first (cheap and gives line counts), then a word diff only inside changed hunks.
 * Diffing whole documents word-by-word would be slow, and counting words of whole changed
 * lines would report a full paragraph as rewritten when a single word changed.
 */
export function computeTextDelta(previous: string, next: string): TextDelta {
  const delta: TextDelta = { wordsAdded: 0, wordsRemoved: 0, linesAdded: 0, linesRemoved: 0 };
  if (previous === next) return delta;
  const parts = diffLines(previous, next);
  let removedBuf = '';
  let addedBuf = '';
  const flush = (): void => {
    if (removedBuf && addedBuf) {
      for (const w of diffWords(removedBuf, addedBuf)) {
        if (w.added) delta.wordsAdded += countWords(w.value);
        else if (w.removed) delta.wordsRemoved += countWords(w.value);
      }
    } else {
      delta.wordsAdded += countWords(addedBuf);
      delta.wordsRemoved += countWords(removedBuf);
    }
    removedBuf = '';
    addedBuf = '';
  };
  for (const part of parts) {
    const lines = part.count ?? countLines(part.value);
    if (part.added) {
      delta.linesAdded += lines;
      addedBuf += part.value;
    } else if (part.removed) {
      delta.linesRemoved += lines;
      removedBuf += part.value;
    } else {
      flush();
    }
  }
  flush();
  return delta;
}
