import {logger, resetLocalSettingsStore, storage} from '@zaiusinc/app-sdk';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {loadConfig, readSection} from './settings';

describe('readSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalSettingsStore();
  });

  it('returns the saved section', async () => {
    await storage.settings.put('fx', {apiToken: 'token', projectId: '23385830076'});
    expect(await readSection('fx')).toEqual({apiToken: 'token', projectId: '23385830076'});
  });

  it('treats an unreadable store as empty, so loadConfig reports missing settings', async () => {
    // What the production store throws on an install that has never saved its settings.
    vi.spyOn(storage.settings, 'get').mockRejectedValue(new Error('Failed to get value at app-data/8454/settings'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(await readSection('fx')).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    expect(await loadConfig()).toEqual({
      ok: false,
      missing: ['FX personal access token', 'FX project ID', 'CMS client ID', 'CMS client secret'],
    });
  });
});
