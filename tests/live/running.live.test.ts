// Read-only: lists the project's flags and the CMS experiments running in production.
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… yarn vitest run tests/live/running.live.test.ts
import {describe, expect, it} from 'vitest';

import {FxClient, runningCmsExperiments} from '../../src/backend/lib/fx';

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';

describe.runIf(live)('running CMS experiments (live, read-only)', () => {
  const fx = new FxClient({token, projectId, environmentKey: 'production', audienceIds: []});

  it('lists flags with variables and per-environment rules', async () => {
    const flags = await fx.listFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => !f.archived)).toBe(true);
    // Every flag carries a production entry with its rules.
    expect(flags.every((f) => Array.isArray(f.environments?.production?.rules_detail))).toBe(true);

    const running = runningCmsExperiments(flags, 'production', (key) => fx.flagUrl(key));
    console.log('flags', flags.length, 'running CMS experiments', JSON.stringify(running));
    for (const e of running) {
      const flag = flags.find((f) => f.key === e.flagKey)!;
      expect(String(flag.variable_definitions?.cms_flag?.default_value)).toBe('true');
    }
  });
});
