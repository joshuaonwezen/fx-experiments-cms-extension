import {describe, expect, it} from 'vitest';

import {CmsClient, CmsItem, summarizeVersions} from './cms';
import {diffVariations, listVersionsOrExplain} from './experiments';
import {ApiError} from './http';
import {FxFlagListItem, runningCmsExperiments} from './fx';

describe('summarizeVersions', () => {
  it('keeps each variation once with its best status, and the newest base name', () => {
    // Shape of GET /v1/content/{key}/locales/en (newest first; base versions omit `variation`).
    const {variations, displayName} = summarizeVersions([
      {key: 'k', version: '6884', locale: 'en', status: 'draft', displayName: 'Homepage'},
      {key: 'k', version: '6882', locale: 'en', status: 'published', variation: 'investments'},
      {key: 'k', version: '6454', locale: 'en', status: 'published', displayName: 'Old name'},
      {key: 'k', version: '6300', locale: 'en', status: 'previous', variation: 'investments'},
      {key: 'k', version: '6200', locale: 'en', status: 'previous', variation: 'business'},
      {key: 'k', version: '6100', locale: 'en', status: 'draft', variation: 'business'},
    ]);
    expect(displayName).toBe('Homepage');
    expect(variations).toEqual([
      {name: 'business', status: 'draft'},
      {name: 'investments', status: 'published'},
    ]);
  });
});

describe('diffVariations', () => {
  const cms = (...names: string[]) => names.map((name) => ({name, status: 'published'}));

  it('finds CMS variations missing from the rule and rule arms missing from the CMS', () => {
    const diff = diffVariations(cms('business', 'personal'), ['control', 'business', 'mortgages', 'off']);
    expect(diff.missingInFx).toEqual(['personal']);
    expect(diff.missingInCms).toEqual(['mortgages']);
    expect(diff.invalid).toEqual([]);
  });

  it('reports names that cannot be FX keys instead of syncing them', () => {
    const diff = diffVariations(cms('Black Friday', 'control', 'ok_name'), ['control']);
    expect(diff.missingInFx).toEqual(['ok_name']);
    expect(diff.invalid.map((i) => i.name)).toEqual(['Black Friday', 'control']);
  });
});

describe('runningCmsExperiments', () => {
  // Shapes from GET /flags/v1/projects/{p}/flags (project 23385830076, 2026-11-05).
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

  it('keeps enabled experiment rules on enabled CMS flags', () => {
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
      url,
    );
    expect(running).toEqual([
      {
        flagKey: 'cms_savings',
        flagName: 'cms_savings',
        ruleKey: 'cms_savings_experiment',
        ruleName: 'cms_savings_experiment',
        route: '/savings',
        flagUrl: 'https://fx/cms_savings',
      },
    ]);
  });

  it('reports a flag without cms_route as covering every route', () => {
    const [only] = runningCmsExperiments(
      [flag('homepage', 'true', null, true, [{key: 'hp_test', type: 'a/b', enabled: true}])],
      'production',
      url,
    );
    expect(only.route).toBe('');
  });

  it('looks only at the requested environment', () => {
    expect(
      runningCmsExperiments(
        [flag('cms_savings', 'true', '/savings', true, [{key: 'r', type: 'a/b', enabled: true}])],
        'development',
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
    // GET /v1/content/{key} for an image on joshCMS: no language versions.
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
