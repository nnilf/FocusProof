import { basename, extname } from 'node:path';
import type { AppCategory, AppRules, SessionTarget } from '@shared/types';
import { findDomain } from '@shared/domains';

export const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'iexplore', 'chromium']);

export interface RelevanceContext {
  rules: AppRules;
  /** Lowercased phrases identifying the assignment (name, module, monitored file names). */
  assignmentKeywords: string[];
}

export interface AppClassification {
  category: AppCategory;
  relevance: number | null;
  matchedRule: string | null;
}

export const normaliseProcess = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/, '');

const listHas = (list: string[], process: string): boolean => list.some((p) => normaliseProcess(p) === process);

export function findKeyword(title: string, keywords: string[]): string | null {
  const t = title.toLowerCase();
  return keywords.find((k) => k.trim().length > 0 && t.includes(k.toLowerCase())) ?? null;
}

export function buildAssignmentKeywords(
  assignment: { name: string; module: string } | null,
  targets: SessionTarget[],
): string[] {
  const words = new Set<string>();
  if (assignment) {
    if (assignment.name.trim().length >= 3) words.add(assignment.name.trim().toLowerCase());
    if (assignment.module.trim().length >= 3) words.add(assignment.module.trim().toLowerCase());
  }
  for (const t of targets) {
    const name = basename(t.path, t.kind === 'file' ? extname(t.path) : '').toLowerCase();
    if (name.length >= 3) words.add(name);
  }
  return [...words];
}

/** Whether a window title names one of the monitored files, e.g. "Essay.docx - Word". */
export function isDraftTitle(title: string | null, targets: SessionTarget[]): boolean {
  if (!title) return false;
  const names = targets
    .filter((t) => t.kind === 'file')
    .map((t) => basename(t.path, extname(t.path)).toLowerCase())
    .filter((n) => n.length >= 3);
  return findKeyword(title, names) !== null;
}

/**
 * Rule-based relevance of the foreground application, ordered from most to least specific. A
 * website's domain beats title keywords; a title naming the assignment beats everything except
 * excluded apps (so a lecture on YouTube about the assignment topic still counts).
 */
export function classifyApplication(
  processName: string | null,
  title: string | null,
  ctx: RelevanceContext,
  domain: string | null = null,
): AppClassification {
  if (!processName) return { category: 'unknown', relevance: null, matchedRule: null };
  const proc = normaliseProcess(processName);
  const t = title ?? '';

  if (listHas(ctx.rules.excludedApps, proc)) return { category: 'excluded', relevance: null, matchedRule: `excluded: ${proc}` };

  const assignmentHit = findKeyword(t, ctx.assignmentKeywords);
  if (assignmentHit) return { category: 'productive', relevance: 1, matchedRule: `title matches assignment "${assignmentHit}"` };

  const productiveSite = findDomain(domain, ctx.rules.productiveDomains);
  if (productiveSite) return { category: 'productive', relevance: 1, matchedRule: `site: ${domain}` };

  const distractingSite = findDomain(domain, ctx.rules.distractingDomains);
  if (distractingSite) return { category: 'distracting', relevance: 0, matchedRule: `site: ${domain}` };

  if (listHas(ctx.rules.distractingApps, proc)) return { category: 'distracting', relevance: 0, matchedRule: `app: ${proc}` };

  const distractingHit = findKeyword(t, ctx.rules.distractingKeywords);
  if (distractingHit) return { category: 'distracting', relevance: 0, matchedRule: `title: "${distractingHit.trim()}"` };

  if (listHas(ctx.rules.productiveApps, proc)) return { category: 'productive', relevance: 1, matchedRule: `app: ${proc}` };

  const productiveHit = findKeyword(t, ctx.rules.productiveKeywords);
  if (productiveHit) return { category: 'productive', relevance: 0.85, matchedRule: `title: "${productiveHit}"` };

  if (BROWSERS.has(proc)) {
    return { category: 'neutral', relevance: 0.5, matchedRule: domain ? `site: ${domain}, no rule` : 'browser, no matching rule' };
  }
  return { category: 'unknown', relevance: 0.4, matchedRule: null };
}
