// End-to-end over the real CMS and FX APIs: the service layer the cms_extension function
// routes to, with the app-sdk's in-memory stores standing in for OCP storage. Reads the
// homepage's variations, builds an experiment on a scratch route (so nothing is served),
// exercises every action, then archives the flag.
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… \
//   OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… yarn vitest run tests/live/experiments.live.test.ts
import {afterAll, describe, expect, it} from 'vitest';

import {CmsClient} from '../../src/backend/lib/cms';
import {
  ActionError,
  createExperiment,
  Deps,
  getStatus,
  linkExisting,
  listExperiments,
  setMetrics,
  setRoute,
  setRunning,
  syncVariations,
  unlink,
} from '../../src/backend/lib/experiments';
import {FxClient} from '../../src/backend/lib/fx';

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';

// The personal instance's homepage: four published variations (business, investments,
// mortgages, personal); version 6882 is the investments variation.
const content = {
  key: '3525e155-2b6f-4615-8be2-850ff6e6fb74',
  locale: 'en',
  version: '6882',
  publicUrl: 'https://opti.joshuaonwezen.dev/',
};
const FLAG = `cms_ext_e2e_${Date.now().toString(36)}`;

describe.runIf(live)('experiment actions (live CMS + FX)', () => {
  const deps: Deps = {
    fx: new FxClient({token, projectId, environmentKey: 'production', audienceIds: [5418466184790016]}),
    cms: new CmsClient({
      clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '',
      clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? '',
    }),
  };

  afterAll(async () => {
    const res = await fetch(`https://api.optimizely.com/flags/v1/projects/${projectId}/flags/archived`, {
      method: 'POST',
      headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({keys: [FLAG]}),
    });
    expect(res.ok).toBe(true);
  });

  it('reads the page and its variations from the CMS', async () => {
    const status = await getStatus(deps, content);
    expect(status.content.key).toBe('3525e1552b6f46158be2850ff6e6fb74');
    expect(status.content.currentVariation).toBe('investments');
    expect(status.content.suggestedRoute).toBe('/');
    expect(status.cmsVariations.map((v) => v.name)).toEqual(
      expect.arrayContaining(['business', 'investments', 'mortgages', 'personal']),
    );
    expect(status.link).toBeNull();
  });

  it('creates, syncs, edits, starts, lists and links an experiment', async () => {
    const events = await deps.fx.listEvents();
    const [e1, e2, e3] = events;

    let status = await createExperiment(deps, {
      content,
      displayName: 'Homepage (e2e)',
      flagKey: FLAG,
      flagName: 'CMS ext e2e',
      route: '/fx-ext-e2e',
      variations: ['business', 'personal'],
      eventIds: [e1.id, e2.id],
      trafficPercent: 50,
      start: false,
    });
    expect(status.link?.flagKey).toBe(FLAG);
    expect(status.rule?.running).toBe(false);
    expect(status.rule?.trafficPercent).toBe(50);
    expect(status.rule?.route).toBe('/fx-ext-e2e');
    expect(status.rule?.variations.map((v) => [v.key, v.percent])).toEqual([
      ['control', 33.34],
      ['business', 33.33],
      ['personal', 33.33],
    ]);
    expect(status.rule?.metrics.map((m) => m.eventId)).toEqual([e1.id, e2.id]);
    // FX only creates the experiment (and its results page) when the rule first starts.
    expect(status.rule?.resultsUrl).toBeNull();
    expect(status.diff.missingInFx.sort()).toEqual(['investments', 'mortgages']);

    await expect(
      createExperiment(deps, {
        content, displayName: 'x', flagKey: FLAG, flagName: 'x', route: '/x',
        variations: ['business'], eventIds: [], trafficPercent: 100, start: false,
      }),
    ).rejects.toMatchObject({code: 'already_linked'});

    status = await syncVariations(deps, {content, confirmRunning: false});
    expect(status.rule?.variations).toHaveLength(5);
    expect(status.rule?.variations.reduce((s, v) => s + v.percent, 0)).toBeCloseTo(100);
    expect(status.diff.missingInFx).toEqual([]);

    status = await setMetrics(deps, {content, eventIds: [e3.id]});
    expect(status.rule?.metrics.map((m) => m.eventId)).toEqual([e3.id]);

    status = await setRoute(deps, {content, route: '/fx-ext-e2e-2'});
    expect(status.rule?.route).toBe('/fx-ext-e2e-2');
    expect(status.link?.route).toBe('/fx-ext-e2e-2');

    status = await setRunning(deps, {content, running: true});
    expect(status.rule?.running).toBe(true);
    expect(status.rule?.resultsUrl).toMatch(/^https:\/\/app\.optimizely\.com\/v2\/projects\/\d+\/results\//);
    status = await setRunning(deps, {content, running: false});
    expect(status.rule?.running).toBe(false);

    const rows = await listExperiments(deps);
    expect(rows.find((r) => r.link.flagKey === FLAG)?.rule?.flagKey).toBe(FLAG);

    status = await unlink(deps, {content});
    expect(status.link).toBeNull();
    status = await linkExisting(deps, {content, displayName: 'Homepage (e2e)', flagKey: FLAG});
    expect(status.link?.ruleKey).toBe(`${FLAG}_experiment`);
    expect(status.rule?.variations).toHaveLength(5);

    await expect(linkExisting(deps, {content, displayName: 'x', flagKey: FLAG})).rejects.toBeInstanceOf(ActionError);
    await unlink(deps, {content});
  });
});
