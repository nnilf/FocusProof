import type { AppRules } from '../types';
import { AI_ASSISTANT_DEFAULTS } from './defaults';

export type PresetSide = 'study' | 'distracting';
export type RuleKind = 'app' | 'domain' | 'keyword';

export interface PresetGroup {
  id: string;
  name: string;
  side: PresetSide;
  apps: string[];
  domains: string[];
  keywords: string[];
}

/** Ready-made groups for the setup wizard. Turning one on adds its entries to the matching lists. */
export const PRESET_GROUPS: PresetGroup[] = [
  {
    id: 'writing',
    name: 'Writing and notes',
    side: 'study',
    apps: ['winword', 'obsidian', 'onenote', 'notion', 'notepad', 'notepad++', 'sublime_text'],
    domains: ['docs.google.com', 'notion.so'],
    keywords: [],
  },
  {
    id: 'office',
    name: 'Spreadsheets and slides',
    side: 'study',
    apps: ['excel', 'powerpnt'],
    domains: ['sheets.google.com', 'slides.google.com'],
    keywords: [],
  },
  {
    id: 'coding',
    name: 'Coding',
    side: 'study',
    apps: ['code', 'cursor', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'rstudio', 'matlab', 'windowsterminal', 'powershell', 'cmd'],
    domains: ['github.com', 'stackoverflow.com', 'developer.mozilla.org'],
    keywords: ['stack overflow', 'github', 'mdn', 'documentation', 'docs'],
  },
  {
    id: 'papers',
    name: 'Papers and PDFs',
    side: 'study',
    apps: ['acrobat', 'acrord32', 'sumatrapdf', 'zotero', 'texstudio'],
    domains: [
      'scholar.google.com',
      'arxiv.org',
      'jstor.org',
      'ieeexplore.ieee.org',
      'pubmed.ncbi.nlm.nih.gov',
      'sciencedirect.com',
      'overleaf.com',
    ],
    keywords: ['scholar', 'arxiv', 'jstor', 'pubmed', 'overleaf'],
  },
  {
    id: 'learning',
    name: 'Courses and reference',
    side: 'study',
    apps: [],
    domains: ['wikipedia.org', 'khanacademy.org', 'coursera.org', 'edx.org'],
    keywords: ['moodle', 'canvas', 'blackboard', 'wikipedia', 'khan academy', 'coursera'],
  },
  {
    id: 'flashcards',
    name: 'Flashcards',
    side: 'study',
    apps: ['anki'],
    domains: ['quizlet.com'],
    keywords: [],
  },
  {
    id: 'ai',
    name: 'AI assistants',
    side: 'study',
    apps: AI_ASSISTANT_DEFAULTS.apps,
    domains: AI_ASSISTANT_DEFAULTS.domains,
    keywords: AI_ASSISTANT_DEFAULTS.keywords,
  },
  {
    id: 'video',
    name: 'Video and streaming',
    side: 'distracting',
    apps: ['netflix'],
    domains: ['youtube.com', 'netflix.com', 'primevideo.com', 'disneyplus.com', 'hulu.com', 'crunchyroll.com', 'twitch.tv'],
    keywords: ['youtube', 'netflix', 'prime video', 'disney+', 'twitch'],
  },
  {
    id: 'social',
    name: 'Social media',
    side: 'distracting',
    apps: [],
    domains: ['reddit.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'facebook.com', '9gag.com'],
    keywords: ['reddit', 'twitter', ' / x', 'instagram', 'tiktok', 'facebook', '9gag'],
  },
  {
    id: 'games',
    name: 'Games',
    side: 'distracting',
    apps: ['steam', 'epicgameslauncher', 'battle.net', 'riotclientservices', 'minecraft'],
    domains: [],
    keywords: [],
  },
  {
    id: 'chat',
    name: 'Chat',
    side: 'distracting',
    apps: ['discord', 'whatsapp', 'telegram'],
    domains: ['web.whatsapp.com', 'discord.com'],
    keywords: [],
  },
];

const LISTS: Record<RuleKind, Record<PresetSide, keyof AppRules>> = {
  app: { study: 'productiveApps', distracting: 'distractingApps' },
  domain: { study: 'productiveDomains', distracting: 'distractingDomains' },
  keyword: { study: 'productiveKeywords', distracting: 'distractingKeywords' },
};

const norm = (v: string): string => v.trim().toLowerCase();
const has = (list: readonly string[], value: string): boolean => list.some((v) => norm(v) === norm(value));

export const ruleKey = (kind: RuleKind, value: string): string => `${kind}:${norm(value)}`;

export function groupEntries(g: PresetGroup): { kind: RuleKind; value: string }[] {
  return [
    ...g.apps.map((value) => ({ kind: 'app' as const, value })),
    ...g.domains.map((value) => ({ kind: 'domain' as const, value })),
    ...g.keywords.map((value) => ({ kind: 'keyword' as const, value })),
  ];
}

/** Which list an entry is in now: study, distracting, or neither. */
export function sideOf(apps: AppRules, kind: RuleKind, value: string): PresetSide | null {
  if (has(apps[LISTS[kind].study], value)) return 'study';
  if (has(apps[LISTS[kind].distracting], value)) return 'distracting';
  return null;
}

export interface RuleChoice {
  kind: RuleKind;
  value: string;
  side: PresetSide | null;
}

/**
 * Applies only the entries the user changed: each is removed from the list it was in and added
 * to the chosen one. Everything else in the lists, including the user's own entries, is kept as
 * is. Returns just the lists that changed, ready for a settings patch.
 */
export function applyChoices(apps: AppRules, choices: readonly RuleChoice[]): Partial<AppRules> {
  const next = new Map<keyof AppRules, string[]>();
  const list = (key: keyof AppRules): string[] => next.get(key) ?? apps[key];
  for (const c of choices) {
    for (const side of ['study', 'distracting'] as const) {
      const key = LISTS[c.kind][side];
      const current = list(key);
      if (side === c.side) {
        if (!has(current, c.value)) next.set(key, [...current, c.value]);
      } else if (has(current, c.value)) {
        next.set(key, current.filter((v) => norm(v) !== norm(c.value)));
      }
    }
  }
  return Object.fromEntries(next) as Partial<AppRules>;
}
