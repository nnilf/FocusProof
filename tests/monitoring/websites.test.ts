import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_DEFAULTS, DEFAULT_SETTINGS, addAiAssistants } from '@shared/settings/defaults';
import { findDomain, normaliseDomain } from '@shared/domains';
import { classifyApplication, type RelevanceContext } from '../../src/main/monitoring/relevanceRules';

const ctx: RelevanceContext = { rules: DEFAULT_SETTINGS.apps, assignmentKeywords: ['urban heat islands'] };

describe('normaliseDomain', () => {
  it('reduces pasted addresses to a bare domain', () => {
    expect(normaliseDomain('https://www.Netflix.com/browse?jbv=1')).toBe('netflix.com');
    expect(normaliseDomain(' moodle.myuni.ac.uk/course/view.php ')).toBe('moodle.myuni.ac.uk');
    expect(normaliseDomain('localhost:3000')).toBe('localhost');
  });
});

describe('findDomain', () => {
  it('matches exact domains and subdomains only', () => {
    expect(findDomain('netflix.com', ['netflix.com'])).toBe('netflix.com');
    expect(findDomain('m.youtube.com', ['youtube.com'])).toBe('youtube.com');
    expect(findDomain('notnetflix.com', ['netflix.com'])).toBeNull();
    expect(findDomain('netflix.com', ['flix.com'])).toBeNull();
    expect(findDomain(null, ['netflix.com'])).toBeNull();
  });
});

describe('classifyApplication with websites', () => {
  it('marks Netflix as distracting even when the tab title says nothing useful', () => {
    const r = classifyApplication('chrome', 'Stranger Things - Google Chrome', ctx, 'netflix.com');
    expect(r).toMatchObject({ category: 'distracting', relevance: 0, matchedRule: 'site: netflix.com' });
  });

  it('marks study sites as productive', () => {
    expect(classifyApplication('brave', 'Search - Brave', ctx, 'scholar.google.com').category).toBe('productive');
    expect(classifyApplication('msedge', 'Edge', ctx, 'en.wikipedia.org').category).toBe('productive');
  });

  it('lets a title naming the assignment win over a distracting site (a lecture on YouTube)', () => {
    const r = classifyApplication('chrome', 'Urban Heat Islands lecture - YouTube', ctx, 'youtube.com');
    expect(r.category).toBe('productive');
  });

  it('falls back to title keywords when no domain is available', () => {
    expect(classifyApplication('chrome', 'Netflix - Google Chrome', ctx, null).category).toBe('distracting');
  });

  it('keeps unknown sites neutral and names the site', () => {
    const r = classifyApplication('firefox', 'Some blog - Mozilla Firefox', ctx, 'someblog.net');
    expect(r).toMatchObject({ category: 'neutral', matchedRule: 'site: someblog.net, no rule' });
  });
});

describe('AI chat assistants', () => {
  it('counts Claude and ChatGPT in the browser as productive', () => {
    const claude = classifyApplication('chrome', 'Essay outline - Claude', ctx, 'claude.ai');
    expect(claude).toMatchObject({ category: 'productive', relevance: 1, matchedRule: 'site: claude.ai' });
    expect(classifyApplication('msedge', 'ChatGPT', ctx, 'chatgpt.com').category).toBe('productive');
  });

  it('counts the desktop apps as productive', () => {
    expect(classifyApplication('Claude.exe', 'Claude', ctx, null).category).toBe('productive');
    expect(classifyApplication('ChatGPT.exe', 'ChatGPT', ctx, null).category).toBe('productive');
  });

  it('adds missing assistants to older saved settings without duplicates', () => {
    const old = { ...DEFAULT_SETTINGS.apps, productiveDomains: ['wikipedia.org', 'claude.ai'], productiveApps: [] };
    const next = addAiAssistants(old);
    expect(next.productiveDomains).toEqual(['wikipedia.org', ...AI_ASSISTANT_DEFAULTS.domains]);
    expect(next.productiveApps).toEqual(AI_ASSISTANT_DEFAULTS.apps);
  });

  it('respects an assistant the user marked as distracting', () => {
    const old = { ...DEFAULT_SETTINGS.apps, productiveDomains: [], distractingDomains: ['chatgpt.com'] };
    expect(addAiAssistants(old).productiveDomains).not.toContain('chatgpt.com');
  });
});
