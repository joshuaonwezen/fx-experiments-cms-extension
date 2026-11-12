import {describe, expect, it} from 'vitest';

import {DEFAULT_PROFILE as P} from '../../shared/profile';
import {CmsClient, CmsItem, CmsVersion, summarizeVersions} from './cms';
import {Datafile, datafileAudiences, isRuleLive, liveCmsRules} from './datafile';
import {deleteCandidates, diffVariations, linkProject, listVersionsOrExplain, promoteVariation} from './experiments';
import {audienceIdsOf, effectiveRoute, FxFlagListItem, runningCmsExperiments} from './fx';
import {ApiError} from './http';

describe('summarizeVersions', () => {
  it('keeps each variation once with its best status, and the newest base name', () => {
    // Shape of GET /v1/content/{key}/locales/en (newest first; base versions omit `variation`).
    const {variations, displayName, basePublished} = summarizeVersions([
      {key: 'k', version: '6884', locale: 'en', status: 'draft', displayName: 'Homepage'},
      {key: 'k', version: '6882', locale: 'en', status: 'published', variation: 'investments'},
      {key: 'k', version: '6454', locale: 'en', status: 'published', displayName: 'Old name'},
      {key: 'k', version: '6300', locale: 'en', status: 'previous', variation: 'investments'},
      {key: 'k', version: '6200', locale: 'en', status: 'previous', variation: 'business'},
      {key: 'k', version: '6100', locale: 'en', status: 'draft', variation: 'business'},
    ]);
    expect(displayName).toBe('Homepage');
    expect(basePublished).toBe(true);
    expect(variations).toEqual([
      {name: 'business', status: 'draft'},
      {name: 'investments', status: 'published'},
    ]);
  });
});

describe('diffVariations', () => {
  const cms = (...names: string[]) => names.map((name) => ({name, status: 'published'}));

  it('finds CMS variations missing from the rule and rule arms missing from the CMS', () => {
    const diff = diffVariations(cms('business', 'personal'), ['control', 'business', 'mortgages', 'off'], P);
    expect(diff.missingInFx).toEqual(['personal']);
    expect(diff.missingInCms).toEqual(['mortgages']);
    expect(diff.invalid).toEqual([]);
  });

  it('flags arms whose CMS variation is not published', () => {
    const diff = diffVariations([{name: 'business', status: 'draft'}], ['control', 'business'], P);
    expect(diff.unpublished).toEqual(['business']);
  });

  it('reports names that cannot be FX keys instead of syncing them', () => {
    const diff = diffVariations(cms('Black Friday', 'control', 'ok_name', 'wx_hero'), ['control'], P);
    expect(diff.missingInFx).toEqual(['ok_name']);
    expect(diff.invalid.map((i) => i.name)).toEqual(['Black Friday', 'control', 'wx_hero']);
  });
});

describe('runningCmsExperiments', () => {
  // Shapes from GET /flags/v1/projects/{p}/flags (2026-11-05).
  const flag = (
    key: string,
    cmsFlag: string | null,
    route: string | null,
    envEnabled: boolean,
    rules: Array<{key: string; type: string; enabled: boolean}>,
  ): FxFlagListItem => ({
    key,
    name: key,
    variable_definitions: {
      ...(cmsFlag === null ? {} : {cms_flag: {key: 'cms_flag', type: 'boolean', default_value: cmsFlag}}),
      ...(route === null ? {} : {cms_route: {key: 'cms_route', type: 'string', default_value: route}}),
    },
    environments: {production: {enabled: envEnabled, rules_detail: rules}},
  });
  const url = (k: string) => `https://fx/${k}`;

  it('keeps enabled experiment and delivery rules on enabled CMS flags', () => {
    const running = runningCmsExperiments(
      [
        flag('cms_savings', 'true', '/savings', true, [{key: 'cms_savings_experiment', type: 'a/b', enabled: true}]),
        // homepage: deliveries running, its A/B rule paused.
        flag('homepage', 'true', null, true, [
          {key: 'business_vs_personal_experiment', type: 'a/b', enabled: false},
          {key: 'business', type: 'targeted_delivery', enabled: true},
        ]),
        // Component experiment: the site's middleware ignores cms_flag false.
        flag('savings_offer', 'false', '', true, [{key: 'savings_offer_experiment', type: 'a/b', enabled: true}]),
        // Rule enabled, but the flag is off in this environment.
        flag('cms_paused_env', 'true', '/x', false, [{key: 'r', type: 'a/b', enabled: true}]),
      ],
      'production',
      P,
      url,
    );
    expect(running.map((r) => [r.flagKey, r.ruleKey, r.kind])).toEqual([
      ['cms_savings', 'cms_savings_experiment', 'experiment'],
      // The persona deliveries change the homepage for some visitors too.
      ['homepage', 'business', 'delivery'],
    ]);
  });

  it('reports a flag without cms_route as covering every route', () => {
    const [only] = runningCmsExperiments(
      [flag('homepage', 'true', null, true, [{key: 'hp_test', type: 'a/b', enabled: true}])],
      'production',
      P,
      url,
    );
    expect(only.route).toBe('');
  });

  it('looks only at the requested environment', () => {
    expect(
      runningCmsExperiments(
        [flag('cms_savings', 'true', '/savings', true, [{key: 'r', type: 'a/b', enabled: true}])],
        'development',
        P,
        url,
      ),
    ).toEqual([]);
  });
});

describe('listVersionsOrExplain', () => {
  const notFound = new ApiError(404, 'cms_not_found', "List versions: HTTP 404 Unable to find content item");
  const cmsWith = (item: CmsItem | null) =>
    ({
      listVersions: () => Promise.reject(notFound),
      getItem: () => Promise.resolve(item),
    }) as unknown as CmsClient;

  it('says media items cannot have variations', async () => {
    // GET /v1/content/{key} for an image on a SaaS CMS instance: no language versions.
    const image = {key: '64c52fe72b1d48b98ced7122189e986b', contentType: 'ImageMedia', locales: ['']};
    await expect(listVersionsOrExplain(cmsWith(image), image.key, 'en')).rejects.toMatchObject({
      code: 'unsupported_content',
      message: expect.stringContaining('ImageMedia'),
    });
  });

  it('names the locales a page does exist in', async () => {
    const page = {key: 'k', contentType: 'ArticlePage', locales: ['nl', 'sv']};
    await expect(listVersionsOrExplain(cmsWith(page), 'k', 'en')).rejects.toMatchObject({
      code: 'locale_missing',
      message: expect.stringContaining('nl, sv'),
    });
  });

  it('reports a deleted item', async () => {
    await expect(listVersionsOrExplain(cmsWith(null), 'k', 'en')).rejects.toMatchObject({code: 'content_missing'});
  });
});

// Trimmed from the live datafile (production, 2026-11-10).
const DATAFILE: Datafile = {
  projectId: '1234567890',
  environmentKey: 'production',
  featureFlags: [
    {
      key: 'homepage',
      experimentIds: [],
      rolloutId: 'r-home',
      variables: [
        {id: '202611', key: 'cms_flag', type: 'boolean', defaultValue: 'true'},
        {id: '235293', key: 'cms_route', type: 'string', defaultValue: '/, /en'},
      ],
    },
    {
      key: 'savings_offer',
      experimentIds: ['e-offer'],
      rolloutId: 'r-offer',
      variables: [
        {id: '229873', key: 'cms_flag', type: 'boolean', defaultValue: 'false'},
        {id: '229874', key: 'cms_route', type: 'string', defaultValue: ''},
      ],
    },
    {
      key: 'nav_cta',
      experimentIds: ['e-nav'],
      rolloutId: 'r-nav',
      variables: [],
    },
  ],
  experiments: [
    {
      id: 'e-offer',
      key: 'savings_offer_experiment',
      status: 'Running',
      variations: ['control', 'rate_led'].map((key, i) => ({
        id: String(i),
        key,
        featureEnabled: true,
        // Defaults say "not CMS"; every variation overrides them.
        variables: [
          {id: '229873', value: 'true'},
          {id: '229874', value: '/savings-offer'},
        ],
      })),
    },
    {id: 'e-nav', key: 'nav_cta_test', status: 'Running', variations: [{id: '9', key: 'on', featureEnabled: true}]},
  ],
  rollouts: [
    {
      id: 'r-home',
      experiments: [
        {id: 'd1', key: 'business', status: 'Running', variations: [{id: 'v1', key: 'business', featureEnabled: true}]},
        {id: 'd0', key: 'default-rollout', status: 'Running', variations: [{id: 'v0', key: 'off', featureEnabled: false}]},
      ],
    },
    {id: 'r-offer', experiments: [{id: 'd2', key: 'default-rollout-2', status: 'Running', variations: [{id: 'o', key: 'off', featureEnabled: false}]}]},
    {id: 'r-nav', experiments: []},
  ],
  audiences: [
    {id: '1111222233334444', name: 'Returning visitors'},
    {id: '$opt_dummy_audience', name: 'Optimizely-Generated Audience for Backwards Compatibility'},
  ],
  typedAudiences: [{id: '6000', name: 'Business Users'}],
};

describe('liveCmsRules', () => {
  it('finds deliveries and per-variation overrides, like the site middleware', () => {
    expect(liveCmsRules(DATAFILE, P)).toEqual([
      {flagKey: 'homepage', ruleKey: 'business', kind: 'delivery', route: '/, /en', variations: ['business']},
      {
        flagKey: 'savings_offer',
        ruleKey: 'savings_offer_experiment',
        kind: 'experiment',
        route: '/savings-offer',
        variations: ['control', 'rate_led'],
      },
    ]);
  });

  it('knows which rules are live and lists audiences by name', () => {
    expect(isRuleLive(DATAFILE, 'savings_offer', 'savings_offer_experiment')).toBe(true);
    expect(isRuleLive(DATAFILE, 'homepage', 'business')).toBe(true);
    expect(isRuleLive(DATAFILE, 'homepage', 'paused_rule')).toBe(false);
    expect(datafileAudiences(DATAFILE)).toEqual([
      {id: 6000, name: 'Business Users'},
      {id: 1111222233334444, name: 'Returning visitors'},
    ]);
  });
});

describe('effectiveRoute', () => {
  const flag = {key: 'f', name: 'f', variable_definitions: {cms_route: {key: 'cms_route', type: 'string', default_value: ''}}};

  it('reads per-variation overrides instead of the blank default', () => {
    const variations = ['control', 'rate_led'].map((key) => ({
      key,
      name: key,
      variables: {cms_route: {key: 'cms_route', type: 'string', value: '/savings-offer', is_default: false}},
    }));
    expect(effectiveRoute(flag, variations, ['control', 'rate_led'], 'cms_route')).toEqual({
      route: '/savings-offer',
      perVariation: true,
    });
  });

  it('falls back to the default', () => {
    expect(effectiveRoute(flag, [], ['control'], 'cms_route')).toEqual({route: '', perVariation: false});
  });
});

describe('audienceIdsOf', () => {
  it('collects ids from nested conditions', () => {
    expect(audienceIdsOf(['or', {audience_id: 1}, ['and', {audience_id: 2}]])).toEqual([1, 2]);
    expect(audienceIdsOf([])).toEqual([]);
  });
});

describe('deleteCandidates', () => {
  const v = (version: string, status: string, variation?: string): CmsVersion => ({
    key: 'k',
    version,
    locale: 'en',
    status,
    ...(variation ? {variation} : {}),
  });
  const content = {
    versions: [v('9', 'published', 'business'), v('8', 'draft', 'investments'), v('7', 'published', 'investments'), v('6', 'published')],
  };
  const link = {
    contentKey: 'k',
    locale: 'en',
    flagKey: 'cms_home',
    ruleKey: 'cms_home_experiment',
    environmentKey: 'production',
    route: '/',
    displayName: 'Home',
    createdAt: '',
  };
  const arms = ['control', 'business', 'investments'];

  it('offers nothing until the experiment has ended', () => {
    expect(deleteCandidates(content, link, arms, [], ['/'], P)).toEqual([]);
  });

  it('keeps control and a winner that FX still serves', () => {
    const ended = {...link, conclusion: {endedAt: '', winner: 'business', shipVia: 'fx' as const}};
    expect(deleteCandidates(content, ended, arms, [], ['/'], P)).toEqual([
      {
        name: 'investments',
        versions: [
          {version: '8', status: 'draft'},
          {version: '7', status: 'published'},
        ],
      },
    ]);
  });

  it('protects variations another live rule serves on this page (a personalization delivery)', () => {
    const ended = {...link, conclusion: {endedAt: '', winner: null, shipVia: null}};
    const personas = [
      {
        flagKey: 'homepage',
        flagName: 'homepage',
        ruleKey: 'business',
        ruleName: 'business',
        kind: 'delivery' as const,
        route: '/, /en',
        variations: ['business'],
        flagUrl: '',
      },
    ];
    expect(deleteCandidates(content, ended, arms, personas, ['/', '/en'], P).map((c) => c.name)).toEqual(['investments']);
    // Without a variation list (Flags API fallback) nothing can be shown to be unused.
    expect(deleteCandidates(content, ended, arms, [{...personas[0], variations: []}], ['/'], P)).toEqual([]);
    // FX unreachable: offer nothing.
    expect(deleteCandidates(content, ended, arms, null, ['/'], P)).toEqual([]);
  });

  it('lets a CMS-promoted winner go only once the new base is published', () => {
    const pending = {...link, conclusion: {endedAt: '', winner: 'business', shipVia: 'cms' as const, promotion: 'awaiting_approval' as const}};
    expect(deleteCandidates(content, pending, arms, [], ['/'], P).map((c) => c.name)).toEqual(['investments']);
    const done = {...link, conclusion: {...pending.conclusion, promotion: 'published' as const}};
    expect(deleteCandidates(content, done, arms, [], ['/'], P).map((c) => c.name)).toEqual(['business', 'investments']);
  });
});

describe('promoteVariation', () => {
  it('publishes a base version with the base properties and the winner composition', async () => {
    const calls: unknown[] = [];
    const cms = {
      createBaseDraft: async (...args: unknown[]) => {
        calls.push(['draft', ...args]);
        return '10';
      },
      patchVersion: async (...args: unknown[]) => {
        calls.push(['patch', ...args]);
      },
      publishVersion: async () => 'published' as const,
    } as unknown as CmsClient;
    const content = {
      key: 'k',
      locale: 'en',
      versions: [
        // A variation version of an experience carries only its composition.
        {key: 'k', version: '9', locale: 'en', status: 'published', variation: 'business', composition: {displayName: 'Home - Business', nodes: [1]}},
        {
          key: 'k',
          version: '6',
          locale: 'en',
          status: 'published',
          displayName: 'Home',
          routeSegment: 'home',
          properties: {seoTitle: {value: 'Home'}},
          composition: {displayName: 'Home', nodes: [0]},
        },
      ],
    };
    await expect(promoteVariation(cms, content, 'business')).resolves.toEqual({version: '10', outcome: 'published'});
    expect(calls).toEqual([
      ['draft', 'k', 'en', {displayName: 'Home', routeSegment: 'home'}],
      ['patch', 'k', '10', {properties: {seoTitle: {value: 'Home'}}, composition: {displayName: 'Home', nodes: [1]}}],
    ]);
  });

  it('refuses when the winner was never published', async () => {
    const content = {key: 'k', locale: 'en', versions: [{key: 'k', version: '6', locale: 'en', status: 'published'}]};
    await expect(promoteVariation({} as CmsClient, content, 'business')).rejects.toMatchObject({code: 'not_ready'});
  });
});

describe('linkProject', () => {
  const link = {contentKey: 'k', locale: 'en', flagKey: 'f', ruleKey: 'r', environmentKey: 'production', route: '/', displayName: 'P', createdAt: ''};

  it('tells links of this project from links of another one', () => {
    expect(linkProject({...link, projectId: '1234567890'}, '1234567890')).toBe('own');
    // The SDK key was changed to another project: a flag of the same name there is a different flag.
    expect(linkProject({...link, projectId: '1234567890'}, '9999999999')).toBe('foreign');
  });

  it('marks links saved before links recorded their project as unknown', () => {
    expect(linkProject(link, '1234567890')).toBe('unknown');
  });
});
