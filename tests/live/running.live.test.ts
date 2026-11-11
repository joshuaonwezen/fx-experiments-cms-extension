// Read-only: lists the project's flags and the CMS rules live in production, from the Flags
// API and (with FX_LIVE_SDK_KEY) from the site's datafile.
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… [FX_LIVE_SDK_KEY=…] \
//   yarn vitest run tests/live/running.live.test.ts
import {describe, expect, it} from 'vitest';

import {fetchDatafile, liveCmsRules} from '../../src/backend/lib/datafile';
import {FxClient, runningCmsExperiments} from '../../src/backend/lib/fx';
import {DEFAULT_PROFILE} from '../../src/shared/profile';

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';
const sdkKey = process.env.FX_LIVE_SDK_KEY ?? '';

describe.runIf(live)('running CMS experiments (live, read-only)', () => {
  const fx = new FxClient({token, projectId, environmentKey: 'production', sdkKey});

  it('lists flags with variables and per-environment rules', async () => {
    const flags = await fx.listFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => !f.archived)).toBe(true);
    // Every flag carries a production entry with its rules.
    expect(flags.every((f) => Array.isArray(f.environments?.production?.rules_detail))).toBe(true);

    const running = runningCmsExperiments(flags, 'production', DEFAULT_PROFILE, (key) => fx.flagUrl(key));
    console.log('flags', flags.length, 'running CMS rules', JSON.stringify(running));
    for (const e of running) {
      const flag = flags.find((f) => f.key === e.flagKey)!;
      expect(String(flag.variable_definitions?.cms_flag?.default_value)).toBe('true');
    }
  });

  it.runIf(Boolean(sdkKey))('reads the same project from the datafile, overrides included', async () => {
    const datafile = await fetchDatafile(sdkKey, {fresh: true});
    expect(datafile.projectId).toBe(projectId);
    const rules = liveCmsRules(datafile, DEFAULT_PROFILE);
    console.log('datafile CMS rules', JSON.stringify(rules));
    expect(rules.every((r) => r.variations.length > 0)).toBe(true);
  });
});
