import {describe, expect, it} from 'vitest';

import {summarizeVersions} from './cms';
import {diffVariations} from './experiments';

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
