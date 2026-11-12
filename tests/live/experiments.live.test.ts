// End-to-end over the real CMS and FX APIs: the service layer the cms_extension function
// routes to, with the app-sdk's in-memory stores standing in for OCP storage. Reads a
// page's variations, builds an experiment on a scratch route (so nothing is served),
// exercises every action, then archives the flag.
//
// It ends the test through an FX rollout only. Never run the "make it the page in the
// CMS" path here: it would publish a new version of the real page. Deleting is off
// (allowDelete: false), so the cleanup step must be refused.
//
// The page needs at least four PUBLISHED variations, listed in FX_LIVE_VARIATIONS.
//   FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… [FX_LIVE_SDK_KEY=…] \
//   OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… \
//   FX_LIVE_CONTENT_KEY=<content key> FX_LIVE_VARIATIONS=a,b,c,d \
//   [FX_LIVE_LOCALE=en] [FX_LIVE_VERSION=<a variation's version>] \
//   [FX_LIVE_PUBLIC_URL=https://www.example.com/page] [FX_LIVE_AUDIENCE_IDS=123,456] \
//   yarn vitest run tests/live/experiments.live.test.ts
import {afterAll, describe, expect, it} from 'vitest';

import {CmsClient} from '../../src/backend/lib/cms';
import {
  ActionError,
  createExperiment,
  deleteVariations,
  Deps,
  endExperiment,
  getResults,
  getStatus,
  linkExisting,
  listExperiments,
  removeVariations,
  setAudiences,
  setMetrics,
  setRoute,
  setRunning,
  setTraffic,
  syncVariations,
  unlink,
} from '../../src/backend/lib/experiments';
import {FxClient} from '../../src/backend/lib/fx';
import {DEFAULT_PROFILE} from '../../src/shared/profile';

const live = process.env.FX_LIVE === '1';
const token = process.env.OPTIMIZELY_FX_API_TOKEN ?? '';
const projectId = process.env.OPTIMIZELY_FX_PROJECT_ID ?? '';

const envList = (raw: string | undefined) => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Four of the page's published variations: two start the test, one is added later and
// removed again, and the winner is shipped from FX.
const [A, B, C, D] = envList(process.env.FX_LIVE_VARIATIONS);
const audienceIds = envList(process.env.FX_LIVE_AUDIENCE_IDS).map(Number);
const content = {
  key: process.env.FX_LIVE_CONTENT_KEY ?? '',
  locale: process.env.FX_LIVE_LOCALE ?? 'en',
  ...(process.env.FX_LIVE_VERSION ? {version: process.env.FX_LIVE_VERSION} : {}),
  ...(process.env.FX_LIVE_PUBLIC_URL ? {publicUrl: process.env.FX_LIVE_PUBLIC_URL} : {}),
};
const FLAG = `cms_ext_e2e_${Date.now().toString(36)}`;

describe.runIf(live && Boolean(content.key) && Boolean(D))('experiment actions (live CMS + FX)', () => {
  const deps: Deps = {
    fx: new FxClient({
      token,
      projectId,
      environmentKey: 'production',
      sdkKey: process.env.FX_LIVE_SDK_KEY ?? '',
    }),
    cms: new CmsClient({
      clientId: process.env.OPTIMIZELY_CMS_CLIENT_ID ?? '',
      clientSecret: process.env.OPTIMIZELY_CMS_CLIENT_SECRET ?? '',
    }),
    profile: DEFAULT_PROFILE,
    allowDelete: false,
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
    expect(status.content.key).toBe(content.key.replace(/-/g, '').toLowerCase());
    if (content.version) expect(status.content.currentVariation).not.toBeNull();
    // Both forms of the default-language URL start with a slash.
    if (content.publicUrl) expect(status.content.suggestedRoute).toMatch(/^\//);
    expect(status.content.basePublished).toBe(true);
    expect(status.cmsVariations.map((v) => v.name)).toEqual(expect.arrayContaining([A, B, C, D]));
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
      variations: [A, B],
      eventIds: [e1.id, e2.id],
      audienceIds,
      trafficPercent: 50,
      start: false,
    });
    expect(status.link?.flagKey).toBe(FLAG);
    expect(status.rule?.running).toBe(false);
    expect(status.rule?.trafficPercent).toBe(50);
    expect(status.rule?.route).toBe('/fx-ext-e2e');
    expect(status.rule?.variations.map((v) => [v.key, v.percent])).toEqual([
      ['control', 33.34],
      [A, 33.33],
      [B, 33.33],
    ]);
    expect(status.rule?.metrics.map((m) => m.eventId)).toEqual([e1.id, e2.id]);
    // FX only creates the experiment (and its results page) when the rule first starts.
    expect(status.rule?.resultsUrl).toBeNull();
    expect(status.diff.missingInFx).toEqual(expect.arrayContaining([C, D]));

    await expect(
      createExperiment(deps, {
        content, displayName: 'x', flagKey: FLAG, flagName: 'x', route: '/x',
        variations: [A], eventIds: [], audienceIds: [], trafficPercent: 100, start: false,
      }),
    ).rejects.toMatchObject({code: 'already_linked'});

    status = await syncVariations(deps, {content, confirmRunning: false});
    // control plus every valid CMS variation on the page.
    expect(status.rule!.variations.length).toBeGreaterThanOrEqual(5);
    const armsAfterSync = status.rule!.variations.length;
    expect(status.rule?.variations.reduce((s, v) => s + v.percent, 0)).toBeCloseTo(100);
    expect(status.diff.missingInFx).toEqual([]);

    status = await removeVariations(deps, {content, variations: [C], confirmRunning: false});
    expect(status.rule?.variations.map((v) => v.key)).not.toContain(C);
    expect(status.rule?.variations.reduce((s, v) => s + v.percent, 0)).toBeCloseTo(100);

    status = await setTraffic(deps, {content, trafficPercent: 30});
    expect(status.rule?.trafficPercent).toBe(30);
    status = await setAudiences(deps, {content, audienceIds: []});
    expect(status.rule?.audienceIds).toEqual([]);

    status = await setMetrics(deps, {content, eventIds: [e3.id]});
    expect(status.rule?.metrics.map((m) => m.eventId)).toEqual([e3.id]);

    status = await setRoute(deps, {content, route: '/fx-ext-e2e-2'});
    expect(status.rule?.route).toBe('/fx-ext-e2e-2');
    expect(status.link?.route).toBe('/fx-ext-e2e-2');

    status = await setRunning(deps, {content, running: true});
    expect(status.rule?.running).toBe(true);
    expect(status.rule?.experimentId).toMatch(/^\d+$/);
    // A fresh experiment has no visitors: either an empty table or a note, never an error.
    const answer = await getResults(deps, content);
    console.log('results', JSON.stringify(answer));
    expect(answer.results !== null || answer.note !== null).toBe(true);
    expect(status.rule?.resultsUrl).toMatch(/^https:\/\/app\.optimizely\.com\/v2\/projects\/\d+\/results\//);
    status = await setRunning(deps, {content, running: false});
    expect(status.rule?.running).toBe(false);

    const {rows} = await listExperiments(deps);
    expect(rows.find((r) => r.link.flagKey === FLAG)?.rule?.flagKey).toBe(FLAG);

    // Ship A from FX: the A/B rule stops, a delivery serves the winner.
    status = await endExperiment(deps, {content, winner: A, shipVia: 'fx'});
    expect(status.link?.conclusion).toMatchObject({winner: A, shipVia: 'fx', deliveryRuleKey: `${FLAG}_winner`});
    expect(status.rule?.running).toBe(false);
    // Resuming is a no-op, ending differently is refused.
    await endExperiment(deps, {content, winner: A, shipVia: 'fx'});
    await expect(endExperiment(deps, {content, winner: B, shipVia: 'fx'})).rejects.toMatchObject({code: 'already_ended'});
    // The winner stays; variations another live rule serves on this page are protected too.
    expect(status.deleteCandidates.map((c) => c.name)).not.toContain(A);
    await expect(deleteVariations(deps, {content, confirm: []})).rejects.toMatchObject({code: 'delete_disabled'});

    status = await unlink(deps, {content});
    expect(status.link).toBeNull();
    status = await linkExisting(deps, {content, displayName: 'Homepage (e2e)', flagKey: FLAG});
    expect(status.link?.ruleKey).toBe(`${FLAG}_experiment`);
    expect(status.rule?.variations).toHaveLength(armsAfterSync - 1);

    await expect(linkExisting(deps, {content, displayName: 'x', flagKey: FLAG})).rejects.toBeInstanceOf(ActionError);
    await unlink(deps, {content});
  });
});
