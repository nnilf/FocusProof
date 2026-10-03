import { describe, expect, it } from 'vitest';
import type { AppRules } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings/defaults';
import { applyChoices, PRESET_GROUPS, sideOf } from '@shared/settings/presets';

const mine: AppRules = {
  ...DEFAULT_SETTINGS.apps,
  productiveApps: ['winword', 'myuni-portal', 'YouTube'],
  distractingApps: ['steam', 'my-game'],
  productiveDomains: ['moodle.myuni.ac.uk', 'youtube.com'],
  distractingDomains: ['netflix.com'],
};

describe('setup presets', () => {
  it('changes only the chosen entries and keeps the user own ones', () => {
    const patch = applyChoices(mine, [
      { kind: 'app', value: 'discord', side: 'distracting' },
      { kind: 'app', value: 'steam', side: null },
    ]);
    expect(patch.distractingApps).toEqual(['my-game', 'discord']);
    expect(Object.keys(patch)).toEqual(['distractingApps']);
  });

  it('moves an entry between sides without duplicates, ignoring case', () => {
    const patch = applyChoices(mine, [{ kind: 'app', value: 'youtube', side: 'distracting' }]);
    expect(patch.productiveApps).toEqual(['winword', 'myuni-portal']);
    expect(patch.distractingApps).toEqual(['steam', 'my-game', 'youtube']);
  });

  it('returns nothing when the choices match the lists', () => {
    expect(applyChoices(mine, [{ kind: 'domain', value: 'youtube.com', side: 'study' }])).toEqual({});
  });

  it('reports which list an entry is in', () => {
    expect(sideOf(mine, 'domain', 'YouTube.com')).toBe('study');
    expect(sideOf(mine, 'app', 'discord')).toBeNull();
  });

  it('has presets that match the defaults where they overlap', () => {
    for (const g of PRESET_GROUPS) {
      for (const app of g.apps) {
        const side = sideOf(DEFAULT_SETTINGS.apps, 'app', app);
        if (side) expect(side).toBe(g.side);
      }
    }
  });
});
