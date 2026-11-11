import {describe, expect, it} from 'vitest';

import {
  addArms,
  defaultFlagKey,
  defaultRoute,
  experimentKeys,
  flagKeyProblem,
  normalizeKey,
  parseAudienceIds,
  previewUrl,
  removeArms,
  routeCovers,
  routeProblem,
  routesOverlap,
  splitTraffic,
  uncoveredPaths,
  variationNameProblem,
  visitorPaths,
  withPaths,
} from './experiment';
import {DEFAULT_PROFILE as P} from './profile';

describe('flagKeyProblem', () => {
  it('accepts FX-style keys', () => {
    expect(flagKeyProblem('cms_savings', P)).toBeNull();
    expect(flagKeyProblem('hero-copy_2', P)).toBeNull();
  });

  it('rejects the site\'s reserved flag keys', () => {
    expect(flagKeyProblem('wx', P)).toMatch(/reserved/);
    expect(flagKeyProblem('wx', {...P, reservedFlagKeys: ['other']})).toBeNull();
  });

  it('rejects empty, invalid characters and the site URL separator', () => {
    expect(flagKeyProblem('', P)).toMatch(/Required/);
    expect(flagKeyProblem('has space', P)).toMatch(/letters/);
    expect(flagKeyProblem('a--b', P)).toMatch(/--/);
    expect(flagKeyProblem('x'.repeat(65), P)).toMatch(/max 64/);
  });
});

describe('variationNameProblem', () => {
  it('accepts names the site can match exactly', () => {
    expect(variationNameProblem('business', P)).toBeNull();
    expect(variationNameProblem('new_visitor', P)).toBeNull();
  });

  it('rejects reserved FX keys, including control', () => {
    for (const name of ['off', 'on', 'control']) expect(variationNameProblem(name, P)).toMatch(/reserved/);
  });

  it('rejects names another tool owns (wx_ by default)', () => {
    expect(variationNameProblem('wx_hero', P)).toMatch(/another tool/);
    expect(variationNameProblem('wx_hero', {...P, reservedVariationPrefixes: ['abc_']})).toBeNull();
  });

  it('follows a configured control key', () => {
    const profile = {...P, controlKey: 'original'};
    expect(variationNameProblem('original', profile)).toMatch(/reserved/);
    expect(variationNameProblem('control', profile)).toBeNull();
  });

  it('rejects names that are not valid FX keys or contain --', () => {
    expect(variationNameProblem('Black Friday', P)).toMatch(/Rename/);
    expect(variationNameProblem('a--b', P)).toMatch(/--/);
  });
});

describe('splitTraffic', () => {
  it('splits evenly and gives the remainder to the first key', () => {
    expect(splitTraffic(['control', 'a', 'b'])).toEqual([
      {key: 'control', weight: 3334},
      {key: 'a', weight: 3333},
      {key: 'b', weight: 3333},
    ]);
  });

  it('always totals 10000 and drops duplicates', () => {
    for (let n = 1; n <= 9; n++) {
      const keys = Array.from({length: n}, (_, i) => `v${i}`);
      expect(splitTraffic(keys).reduce((s, a) => s + a.weight, 0)).toBe(10000);
    }
    expect(splitTraffic(['a', 'a', 'b'])).toHaveLength(2);
    expect(splitTraffic([])).toEqual([]);
  });
});

describe('experimentKeys', () => {
  it('puts control first and never twice', () => {
    expect(experimentKeys(['business', 'control', 'personal'], 'control')).toEqual(['control', 'business', 'personal']);
  });
});

describe('routeProblem', () => {
  it('accepts what middleware routeMatches() understands', () => {
    for (const r of ['/', '/savings', '/products/*', '/*', '/a, /b/*']) expect(routeProblem(r)).toBeNull();
  });

  it('rejects empty, relative and mid-path wildcards', () => {
    expect(routeProblem('')).toMatch(/Required/);
    expect(routeProblem('/a,')).toMatch(/Required/);
    expect(routeProblem('savings')).toMatch(/start with/);
    expect(routeProblem('/a*b')).toMatch(/trailing/);
  });
});

describe('defaults', () => {
  it('slugs the page name into a cms_ flag key', () => {
    expect(defaultFlagKey('Homepage – Business', 'abc')).toBe('cms_homepage_business');
    expect(defaultFlagKey('Crème brûlée', 'abc')).toBe('cms_creme_brulee');
    expect(defaultFlagKey('', 'abc12345')).toBe('cms_abc12345');
    expect(defaultFlagKey('x'.repeat(100), 'abc').length).toBeLessThanOrEqual(64);
  });

  it('turns a public URL into the routes visitors request', () => {
    expect(defaultRoute('https://site.example/savings/', 'en', 'en')).toBe('/savings, /en/savings');
    expect(defaultRoute('https://site.example/', 'en', 'en')).toBe('/, /en');
    expect(defaultRoute('/investments/', 'nl', 'en')).toBe('/investments');
    expect(defaultRoute(undefined, 'en', 'en')).toBe('');
  });

  it('parses audience ids leniently', () => {
    expect(parseAudienceIds('1111222233334444, ,abc,42')).toEqual([1111222233334444, 42]);
    expect(parseAudienceIds(undefined)).toEqual([]);
  });

  it('normalizes content keys with or without dashes', () => {
    expect(normalizeKey('0F8E2D6C-4b1a-49e7-a3c5-d7f9b2e4c6a8')).toBe('0f8e2d6c4b1a49e7a3c5d7f9b2e4c6a8');
  });
});

describe('routesOverlap', () => {
  it('matches exact routes, ignoring a trailing slash', () => {
    expect(routesOverlap('/savings', '/savings/')).toBe(true);
    expect(routesOverlap('/savings', '/mortgages')).toBe(false);
    expect(routesOverlap('/', '/savings')).toBe(false);
  });

  it('treats an empty route and /* as every route', () => {
    expect(routesOverlap('', '/savings')).toBe(true);
    expect(routesOverlap('/*', '/anything/deep')).toBe(true);
  });

  it('matches prefixes against exact routes and other prefixes', () => {
    expect(routesOverlap('/products/*', '/products')).toBe(true);
    expect(routesOverlap('/products/*', '/products/loans')).toBe(true);
    expect(routesOverlap('/products/*', '/productsx')).toBe(false);
    expect(routesOverlap('/products/*', '/products/loans/*')).toBe(true);
    expect(routesOverlap('/products/*', '/savings/*')).toBe(false);
  });

  it('overlaps when any comma-separated entry does', () => {
    expect(routesOverlap('/a, /b', '/c, /b')).toBe(true);
    expect(routesOverlap('/a, /b', '/c')).toBe(false);
  });
});

describe('addArms / removeArms', () => {
  const total = (arms: Array<{weight: number}>) => arms.reduce((s, a) => s + a.weight, 0);

  it('keeps a custom split\'s shape when adding an arm', () => {
    const next = addArms(
      [
        {key: 'control', weight: 5000},
        {key: 'a', weight: 2500},
        {key: 'b', weight: 2500},
      ],
      ['c'],
    );
    expect(next).toEqual([
      {key: 'control', weight: 3750},
      {key: 'a', weight: 1875},
      {key: 'b', weight: 1875},
      {key: 'c', weight: 2500},
    ]);
    expect(total(next)).toBe(10000);
  });

  it('keeps an even split even', () => {
    expect(addArms(splitTraffic(['control', 'a']), ['b']).map((a) => a.weight)).toEqual([3334, 3333, 3333]);
  });

  it('ignores keys already in the rule', () => {
    const arms = splitTraffic(['control', 'a']);
    expect(addArms(arms, ['a'])).toBe(arms);
  });

  it('gives a removed arm\'s traffic back in proportion', () => {
    const next = removeArms(
      [
        {key: 'control', weight: 5000},
        {key: 'a', weight: 2500},
        {key: 'b', weight: 2500},
      ],
      ['b'],
    );
    expect(next).toEqual([
      {key: 'control', weight: 6667},
      {key: 'a', weight: 3333},
    ]);
  });
});

describe('routeCovers', () => {
  it('mirrors the site\'s routeMatches()', () => {
    expect(routeCovers('', '/anything')).toBe(true);
    expect(routeCovers('/*', '/a/b')).toBe(true);
    expect(routeCovers('/products/*', '/products')).toBe(true);
    expect(routeCovers('/products/*', '/products/loans/x')).toBe(true);
    expect(routeCovers('/products/*', '/productsx')).toBe(false);
    expect(routeCovers('/savings/', '/savings')).toBe(true);
    expect(routeCovers('/, /en', '/en/')).toBe(true);
    // Case-sensitive, like the site.
    expect(routeCovers('/Savings', '/savings')).toBe(false);
  });
});

describe('visitorPaths', () => {
  it('gives the primary language both URL forms', () => {
    // cms_personal_banking was created as /en/personal-banking, which English visitors never request.
    expect(visitorPaths('https://site.example/en/personal-banking/', 'en', 'en')).toEqual([
      '/personal-banking',
      '/en/personal-banking',
    ]);
    expect(visitorPaths('https://site.example/personal-banking', 'en', 'en')).toEqual([
      '/personal-banking',
      '/en/personal-banking',
    ]);
    expect(visitorPaths('https://site.example/', 'en', 'en')).toEqual(['/', '/en']);
  });

  it('follows the page, not a site setting, for the primary language', () => {
    // A site whose pages are created in Dutch first.
    expect(visitorPaths('https://site.example/nl/sparen', 'nl', 'nl')).toEqual(['/sparen', '/nl/sparen']);
  });

  it('keeps translations as the CMS reports them', () => {
    // A bare /about here would also be the English page.
    expect(visitorPaths('https://site.example/nl/about/', 'nl', 'en')).toEqual(['/nl/about']);
  });

  it('lists the paths a route misses, and adds them', () => {
    const paths = visitorPaths('https://site.example/en/personal-banking', 'en', 'en');
    expect(uncoveredPaths('/en/personal-banking', paths)).toEqual(['/personal-banking']);
    expect(withPaths('/en/personal-banking', paths)).toBe('/en/personal-banking, /personal-banking');
    expect(withPaths('/*', paths)).toBe('/*');
  });
});

describe('previewUrl', () => {
  it('fills the site\'s preview path', () => {
    expect(previewUrl('https://site.example/en/savings', '/savings', 'cms_savings', 'rate_led', P)).toBe(
      'https://site.example/savings/__v_cms_savings--rate_led',
    );
    expect(previewUrl('https://site.example/', '/', 'homepage', 'business', P)).toBe(
      'https://site.example/__v_homepage--business',
    );
  });

  it('is off when the site has no preview path', () => {
    expect(previewUrl('https://site.example/x', '/x', 'f', 'v', {...P, previewPath: ''})).toBeNull();
  });
});
