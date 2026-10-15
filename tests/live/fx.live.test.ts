// Drives every FX call the extension makes against the real API, on a throwaway flag,
// then archives it. Run from this repo with the FX creds in the environment:
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… yarn vitest run tests/live/fx.live.test.ts
import {afterAll, describe, expect, it} from 'vitest';

import {FxClient, metricFor, summarizeRule} from '../../src/backend/lib/fx';
import {CONTROL_VARIATION_KEY} from '../../src/shared/constants';

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';
const audienceIds = (process.env.FX_LIVE_AUDIENCE_IDS ?? '').split(',').map(Number).filter(Boolean);

const FLAG = `cms_ext_smoke_${Date.now().toString(36)}`;
const RULE = `${FLAG}_experiment`;

describe.runIf(live)('FX lifecycle (live)', () => {
  const fx = new FxClient({token, projectId, environmentKey: 'production', audienceIds});

  afterAll(async () => {
    // Pause and archive so the datafile (and exp:seed) never sees a running smoke flag.
    try {
      await fx.setRuleRunning(FLAG, RULE, false);
    } catch (e) {
      console.warn('pause in cleanup failed', e);
    }
    const res = await fetch(`https://api.optimizely.com/flags/v1/projects/${projectId}/flags/archived`, {
      method: 'POST',
      headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({keys: [FLAG]}),
    });
    console.log('archive', res.status, (await res.text()).slice(0, 300));
  });

  it('runs create → variations → rule → metrics → re-split → route → start → pause', async () => {
    expect(await fx.getFlag(FLAG)).toBeNull();

    const flag = await fx.createFlag(FLAG, 'CMS ext smoke', 'Throwaway flag from fx.live.test.ts', '/fx-ext-smoke');
    expect(flag.key).toBe(FLAG);
    console.log('variable_definitions', JSON.stringify((await fx.getFlag(FLAG))?.variable_definitions));

    const initial = (await fx.listVariations(FLAG)).map((v) => v.key).sort();
    console.log('initial variations', initial);

    await fx.createVariation(FLAG, CONTROL_VARIATION_KEY, 'Control (original page)');
    await fx.createVariation(FLAG, 'smoke_a', 'smoke_a');
    const variations = await fx.listVariations(FLAG);
    console.log('variation variables', JSON.stringify(variations.find((v) => v.key === 'smoke_a')?.variables));

    const events = await fx.listEvents();
    expect(events.length).toBeGreaterThan(0);
    const [e1, e2] = events;

    let ruleset = await fx.addAbRule(
      FLAG,
      RULE,
      'CMS ext smoke experiment',
      [{key: CONTROL_VARIATION_KEY, name: 'Control (original page)'}, {key: 'smoke_a', name: 'smoke_a'}],
      [metricFor(e1)],
      50,
    );
    const rule = ruleset.rules[RULE];
    console.log('after add: ruleset.enabled', ruleset.enabled, 'priorities', ruleset.rule_priorities,
      'rule.enabled', rule?.enabled, 'status', rule?.status, 'results', rule?.fetch_results_ui_url,
      'pct', rule?.percentage_included, 'variations', JSON.stringify(rule?.variations));
    expect(rule).toBeDefined();
    // A rule missing from rule_priorities never makes it into the datafile.
    expect((await fx.getRuleset(FLAG)).rule_priorities ?? []).toContain(RULE);

    ruleset = await fx.setRuleMetrics(FLAG, RULE, [metricFor(e1), metricFor(e2)]);
    expect(ruleset.rules[RULE].metrics?.map((m) => m.event_id)).toEqual([e1.id, e2.id]);

    await fx.createVariation(FLAG, 'smoke_b', 'smoke_b');
    ruleset = await fx.setRuleVariations(FLAG, RULE, [
      {key: CONTROL_VARIATION_KEY, name: 'Control (original page)'},
      {key: 'smoke_a', name: 'smoke_a'},
      {key: 'smoke_b', name: 'smoke_b'},
    ]);
    console.log('re-split', JSON.stringify(ruleset.rules[RULE].variations));
    const total = Object.values(ruleset.rules[RULE].variations).reduce((s, v) => s + v.percentage_included, 0);
    expect(total).toBe(10000);

    await fx.setRouteDefault(FLAG, '/fx-ext-smoke-2');
    const routed = await fx.getFlag(FLAG);
    console.log('route after update', routed?.variable_definitions?.cms_route?.default_value);
    expect(routed?.variable_definitions?.cms_route?.default_value).toBe('/fx-ext-smoke-2');

    ruleset = await fx.setRuleRunning(FLAG, RULE, true);
    console.log('after start: ruleset.enabled', ruleset.enabled, 'rule', ruleset.rules[RULE].enabled, ruleset.rules[RULE].status);
    const started = summarizeRule(routed!, RULE, ruleset.rules[RULE], ruleset, 'production', fx.flagUrl(FLAG));
    console.log('summary', JSON.stringify(started));
    expect(started.running).toBe(true);
    expect(ruleset.rule_priorities ?? []).toContain(RULE);

    ruleset = await fx.setRuleRunning(FLAG, RULE, false);
    console.log('after pause: ruleset.enabled', ruleset.enabled, 'rule', ruleset.rules[RULE].enabled, ruleset.rules[RULE].status);
    expect(ruleset.rules[RULE].enabled).toBe(false);
  });
});
