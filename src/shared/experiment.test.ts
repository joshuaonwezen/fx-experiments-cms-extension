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
import {DEFAULT_PROFILE as P, siteSettingsProblems, toSiteProfile} from './profile';

describe('flagKeyProblem', () => {
  it('accepts FX-style keys', () => {
    expect(flagKeyProblem('cms_savings', P)).toBeNull();
    expect(flagKeyProblem('hero-copy_2', P)).toBeNull();
  });

  it('rejects the site\'s reserved flag keys', () => {
    expect(flagKeyProblem('wx', P)).toMatch(/reserved/);
    expect(flagKeyProblem('wx', toSiteProfile({reservedFlagKeys: 'other'}))).toBeNull();
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
    expect(variationNameProblem('wx_hero', toSiteProfile({reservedVariationPrefixes: 'abc_'}))).toBeNull();
  });

  it('follows a configured control key', () => {
    const profile = toSiteProfile({controlKey: 'original'});
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

  it('turns a public URL into the route visitors request', () => {
    const bare = toSiteProfile({defaultLocaleUrls: 'bare'});
    expect(defaultRoute('https://site.example/savings/', 'en', bare)).toBe('/savings');
    expect(defaultRoute('https://site.example/', 'en', bare)).toBe('/');
    expect(defaultRoute('/investments/', 'en', bare)).toBe('/investments');
    expect(defaultRoute(undefined, 'en', bare)).toBe('');
  });

  it('parses audience ids leniently', () => {
    expect(parseAudienceIds('5418466184790016, ,abc,42')).toEqual([5418466184790016, 42]);
    expect(parseAudienceIds(undefined)).toEqual([]);
  });

  it('normalizes content keys with or without dashes', () => {
    expect(normalizeKey('3525E155-2b6f-4615-8be2-850ff6e6fb74')).toBe('3525e1552b6f46158be2850ff6e6fb74');
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
  it('offers both default-language forms by default', () => {
    // cms_personal_banking was created as /en/personal-banking, which English visitors never request.
    expect(visitorPaths('https://site.example/en/personal-banking/', 'en', P)).toEqual([
      '/personal-banking',
      '/en/personal-banking',
    ]);
    expect(visitorPaths('https://site.example/personal-banking', 'en', P)).toEqual([
      '/personal-banking',
      '/en/personal-banking',
    ]);
    expect(visitorPaths('https://site.example/', 'en', P)).toEqual(['/', '/en']);
  });

  it('follows the configured URL style', () => {
    expect(visitorPaths('https://site.example/en/x', 'en', toSiteProfile({defaultLocaleUrls: 'bare'}))).toEqual(['/x']);
    expect(visitorPaths('https://site.example/x', 'en', toSiteProfile({defaultLocaleUrls: 'prefixed'}))).toEqual(['/en/x']);
  });

  it('keeps other languages as the CMS reports them', () => {
    expect(visitorPaths('https://site.example/nl/sparen/', 'nl', P)).toEqual(['/nl/sparen']);
  });

  it('lists the paths a route misses, and adds them', () => {
    const paths = visitorPaths('https://site.example/en/personal-banking', 'en', P);
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
    expect(previewUrl('https://site.example/x', '/x', 'f', 'v', toSiteProfile({previewPath: 'none'}))).toBeNull();
  });
});

describe('site settings', () => {
  it('fills blanks with the optimizely-nextjs-demo convention', () => {
    expect(toSiteProfile({})).toEqual(P);
    expect(toSiteProfile({markerVariable: '  ', reservedFlagKeys: ''})).toEqual(P);
  });

  it('rejects values the site could not use', () => {
    expect(siteSettingsProblems({markerVariable: 'has space'}).markerVariable).toBeTruthy();
    expect(siteSettingsProblems({markerVariable: 'x', routeVariable: 'x'}).routeVariable).toBeTruthy();
    expect(siteSettingsProblems({previewPath: '/__v_{flag}'}).previewPath).toBeTruthy();
    expect(siteSettingsProblems({previewPath: 'none', defaultLocale: 'en-GB'})).toEqual({});
  });
});
