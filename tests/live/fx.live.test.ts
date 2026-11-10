// Drives every FX call the extension makes against the real API, on a throwaway flag,
// then archives it. Run from this repo with the FX creds in the environment:
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… yarn vitest run tests/live/fx.live.test.ts
import {afterAll, describe, expect, it} from 'vitest';

import {FxClient, metricFor, summarizeRule} from '../../src/backend/lib/fx';
import {addArms, splitTraffic} from '../../src/shared/experiment';
import {DEFAULT_PROFILE} from '../../src/shared/profile';

const CONTROL_VARIATION_KEY = DEFAULT_PROFILE.controlKey;

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';
const audienceIds = (process.env.FX_LIVE_AUDIENCE_IDS ?? '').split(',').map(Number).filter(Boolean);

const FLAG = `cms_ext_smoke_${Date.now().toString(36)}`;
const RULE = `${FLAG}_experiment`;
const DELIVERY = `${FLAG}_winner`;

describe.runIf(live)('FX lifecycle (live)', () => {
  const fx = new FxClient({token, projectId, environmentKey: 'production', sdkKey: '', audienceIds});

  afterAll(async () => {
    // Pause and archive so the datafile (and exp:seed) never sees a running smoke flag.
    for (const rule of [RULE, DELIVERY]) {
      try {
        await fx.setRuleRunning(FLAG, rule, false);
      } catch (e) {
        console.warn('pause in cleanup failed', rule, e);
      }
    }
    await fx.archiveFlag(FLAG);
    expect((await fx.getFlag(FLAG))?.archived).toBe(true);
  });

  it('runs create → variations → rule → metrics → re-split → traffic → audience → route → start → deliver → pause', async () => {
    expect(await fx.getFlag(FLAG)).toBeNull();

    const flag = await fx.createFlag(FLAG, 'CMS ext smoke', 'Throwaway flag from fx.live.test.ts', '/fx-ext-smoke', DEFAULT_PROFILE);
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
      splitTraffic([CONTROL_VARIATION_KEY, 'smoke_a']).map((a) => ({...a, name: a.key})),
      [metricFor(e1)],
      50,
      audienceIds,
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
    // A custom 60/40 split keeps its shape when an arm is added.
    ruleset = await fx.setRuleArms(FLAG, RULE, [
      {key: CONTROL_VARIATION_KEY, name: 'Control (original page)', weight: 6000},
      {key: 'smoke_a', name: 'smoke_a', weight: 4000},
    ]);
    const arms = addArms(
      Object.values(ruleset.rules[RULE].variations).map((v) => ({key: v.key, weight: v.percentage_included})),
      ['smoke_b'],
    );
    ruleset = await fx.setRuleArms(FLAG, RULE, arms.map((a) => ({...a, name: a.key})));
    console.log('re-split', JSON.stringify(ruleset.rules[RULE].variations));
    const total = Object.values(ruleset.rules[RULE].variations).reduce((s, v) => s + v.percentage_included, 0);
    expect(total).toBe(10000);
    // 60/40 scaled into the 6667 left after smoke_b's even third; the rounding remainder goes to control.
    expect(ruleset.rules[RULE].variations[CONTROL_VARIATION_KEY].percentage_included).toBe(4001);
    expect(ruleset.rules[RULE].variations.smoke_a.percentage_included).toBe(2666);

    ruleset = await fx.setRuleTraffic(FLAG, RULE, 25);
    expect(ruleset.rules[RULE].percentage_included).toBe(2500);
    ruleset = await fx.setRuleAudiences(FLAG, RULE, []);
    console.log('audience_conditions after clear', JSON.stringify(ruleset.rules[RULE].audience_conditions));

    await fx.setRouteDefault(FLAG, DEFAULT_PROFILE.routeVariable, '/fx-ext-smoke-2');
    const routed = await fx.getFlag(FLAG);
    console.log('route after update', routed?.variable_definitions?.cms_route?.default_value);
    expect(routed?.variable_definitions?.cms_route?.default_value).toBe('/fx-ext-smoke-2');

    ruleset = await fx.setRuleRunning(FLAG, RULE, true);
    console.log('after start: ruleset.enabled', ruleset.enabled, 'rule', ruleset.rules[RULE].enabled, ruleset.rules[RULE].status);
    const started = summarizeRule(
      routed!,
      RULE,
      ruleset.rules[RULE],
      ruleset,
      'production',
      fx.flagUrl(FLAG),
      DEFAULT_PROFILE,
      await fx.listVariations(FLAG),
    );
    console.log('summary', JSON.stringify(started));
    expect(started.running).toBe(true);
    expect(started.route).toBe('/fx-ext-smoke-2');
    expect(started.routePerVariation).toBe(false);
    expect(ruleset.rule_priorities ?? []).toContain(RULE);

    ruleset = await fx.setRuleRunning(FLAG, RULE, false);
    console.log('after pause: ruleset.enabled', ruleset.enabled, 'rule', ruleset.rules[RULE].enabled, ruleset.rules[RULE].status);
    expect(ruleset.rules[RULE].enabled).toBe(false);

    // Shipping a winner from FX: a targeted delivery of one variation to 100%.
    ruleset = await fx.addDeliveryRule(FLAG, DELIVERY, 'Winner: smoke_a', {key: 'smoke_a', name: 'smoke_a'}, []);
    console.log('delivery rule', JSON.stringify(ruleset.rules[DELIVERY]), 'priorities', ruleset.rule_priorities);
    expect(ruleset.rules[DELIVERY]?.type).toBe('targeted_delivery');
    ruleset = await fx.setRuleRunning(FLAG, DELIVERY, true);
    expect(ruleset.rules[DELIVERY].enabled).toBe(true);
    expect(ruleset.rules[DELIVERY].variations.smoke_a?.percentage_included).toBe(10000);
  });
});
