import type { AppRules, Settings, SettingsPatch } from '../types';

/** AI chat assistants, used for research and testing ideas: productive by default. */
export const AI_ASSISTANT_DEFAULTS = {
  domains: [
    'claude.ai',
    'chatgpt.com',
    'chat.openai.com',
    'gemini.google.com',
    'copilot.microsoft.com',
    'perplexity.ai',
    'notebooklm.google.com',
  ],
  apps: ['claude', 'chatgpt'],
  // "claude" alone would match too many unrelated window titles.
  keywords: ['chatgpt'],
};

export const DEFAULT_SETTINGS: Settings = {
  engine: {
    inactivityThresholdSec: 120,
    readingPauseSec: 180,
    awayThresholdSec: 300,
    absenceThresholdSec: 60,
    offScreenPolicy: 'neutral',
    productiveThreshold: 0.6,
    neutralThreshold: 0.35,
    neutralContribution: 0.5,
    weights: { relevance: 0.3, input: 0.2, document: 0.25, camera: 0.15, context: 0.1 },
  },
  analysisIntervalSec: 5,
  monitoring: {
    webcam: false,
    screenAnalysis: true,
    activeWindow: true,
    inputActivity: true,
    documents: true,
  },
  apps: {
    productiveApps: [
      'winword',
      'code',
      'cursor',
      'devenv',
      'idea64',
      'pycharm64',
      'webstorm64',
      'rstudio',
      'matlab',
      'notepad',
      'notepad++',
      'sublime_text',
      'obsidian',
      'onenote',
      'excel',
      'powerpnt',
      'acrobat',
      'acrord32',
      'sumatrapdf',
      'zotero',
      'windowsterminal',
      'powershell',
      'cmd',
      'texstudio',
      'anki',
      ...AI_ASSISTANT_DEFAULTS.apps,
    ],
    distractingApps: ['steam', 'epicgameslauncher', 'discord', 'whatsapp', 'telegram', 'netflix', 'battle.net'],
    excludedApps: ['focusproof', 'electron', 'explorer', 'lockapp', 'searchhost', 'shellexperiencehost'],
    productiveKeywords: [
      'stack overflow',
      'scholar',
      'wikipedia',
      'arxiv',
      'jstor',
      'moodle',
      'canvas',
      'blackboard',
      'documentation',
      'docs',
      'mdn',
      'github',
      'overleaf',
      'khan academy',
      'coursera',
      'pubmed',
      ...AI_ASSISTANT_DEFAULTS.keywords,
    ],
    distractingKeywords: [
      'youtube',
      'netflix',
      'reddit',
      'twitter',
      ' / x',
      'instagram',
      'tiktok',
      'facebook',
      'twitch',
      'prime video',
      'disney+',
      '9gag',
    ],
    productiveDomains: [
      'scholar.google.com',
      'docs.google.com',
      'wikipedia.org',
      'stackoverflow.com',
      'github.com',
      'arxiv.org',
      'jstor.org',
      'ieeexplore.ieee.org',
      'pubmed.ncbi.nlm.nih.gov',
      'sciencedirect.com',
      'overleaf.com',
      'khanacademy.org',
      'coursera.org',
      'developer.mozilla.org',
      ...AI_ASSISTANT_DEFAULTS.domains,
    ],
    distractingDomains: [
      'netflix.com',
      'youtube.com',
      'primevideo.com',
      'disneyplus.com',
      'hulu.com',
      'crunchyroll.com',
      'twitch.tv',
      'reddit.com',
      'twitter.com',
      'x.com',
      'instagram.com',
      'tiktok.com',
      'facebook.com',
      '9gag.com',
    ],
  },
  privacy: { storeWindowTitles: true, readBrowserDomains: true },
  camera: { samplesPerSecond: 2, lookAwayAngleDeg: 25, zones: [], eyeGain: { x: 0, y: 0 } },
  overlay: {
    enabled: true,
    corner: 'top-right',
    displayId: null,
    size: 'small',
    details: { label: false, focusScore: false, alt: false, camera: false },
  },
};

/** Deep-merges a validated patch into settings; arrays are replaced, not concatenated. */
export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return {
    engine: {
      ...base.engine,
      ...patch.engine,
      weights: { ...base.engine.weights, ...patch.engine?.weights },
    },
    analysisIntervalSec: patch.analysisIntervalSec ?? base.analysisIntervalSec,
    monitoring: { ...base.monitoring, ...patch.monitoring },
    apps: { ...base.apps, ...patch.apps },
    privacy: { ...base.privacy, ...patch.privacy },
    camera: { ...base.camera, ...patch.camera },
    overlay: {
      ...base.overlay,
      ...patch.overlay,
      details: { ...base.overlay.details, ...patch.overlay?.details },
    },
  };
}

/**
 * Adds the AI assistant rules to settings saved before they were defaults. Entries already present,
 * or that the user marked as distracting, are left alone.
 */
export function addAiAssistants(apps: AppRules): AppRules {
  const merge = (list: string[], add: string[], distracting: string[]): string[] => {
    const has = new Set([...list, ...distracting].map((v) => v.trim().toLowerCase()));
    return [...list, ...add.filter((v) => !has.has(v))];
  };
  return {
    ...apps,
    productiveDomains: merge(apps.productiveDomains, AI_ASSISTANT_DEFAULTS.domains, apps.distractingDomains),
    productiveApps: merge(apps.productiveApps, AI_ASSISTANT_DEFAULTS.apps, apps.distractingApps),
    productiveKeywords: merge(apps.productiveKeywords, AI_ASSISTANT_DEFAULTS.keywords, apps.distractingKeywords),
  };
}
