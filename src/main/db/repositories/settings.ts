import type { Settings, SettingsPatch } from '@shared/types';
import { addAiAssistants, DEFAULT_SETTINGS, mergeSettings } from '@shared/settings/defaults';
import { settingsPatchSchema } from '@shared/ipc/schemas';
import type { Db } from '../connection';

const SETTINGS_KEY = 'settings';
/** Set once AI assistant rules have been added to saved settings, so removing one sticks. */
const AI_ASSISTANTS_KEY = 'aiAssistantsAdded';

export class SettingsRepository {
  private cache: Settings | null = null;

  constructor(private readonly db: Db) {}

  get(): Settings {
    if (this.cache) return this.cache;
    const stored = this.getValue(SETTINGS_KEY);
    // Stored settings are re-validated so a hand-edited or older value can never break the app.
    const parsed = settingsPatchSchema.safeParse(stored ?? {});
    this.cache = mergeSettings(DEFAULT_SETTINGS, parsed.success ? (parsed.data as SettingsPatch) : {});
    if (this.getValue(AI_ASSISTANTS_KEY) !== true) {
      this.setValue(AI_ASSISTANTS_KEY, true);
      if (stored !== undefined) this.update({ apps: addAiAssistants(this.cache.apps) });
    }
    return this.cache;
  }

  update(patch: SettingsPatch): Settings {
    const next = mergeSettings(this.get(), patch);
    this.setValue(SETTINGS_KEY, next);
    this.cache = next;
    return next;
  }

  reset(): Settings {
    this.setValue(SETTINGS_KEY, DEFAULT_SETTINGS);
    this.cache = DEFAULT_SETTINGS;
    return DEFAULT_SETTINGS;
  }

  getValue(key: string): unknown {
    const row = this.db.prepare('SELECT value_json FROM user_settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return undefined;
    }
  }

  setValue(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO user_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(key, JSON.stringify(value));
  }
}
