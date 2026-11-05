import {describe, expect, it} from 'vitest';

import {summarizeVersions} from './cms';
import {diffVariations} from './experiments';
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
