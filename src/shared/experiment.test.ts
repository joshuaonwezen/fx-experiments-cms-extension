import {describe, expect, it} from 'vitest';

import {
  defaultFlagKey,
  defaultRoute,
  experimentKeys,
  flagKeyProblem,
  normalizeKey,
  parseAudienceIds,
  routeProblem,
  routesOverlap,
  splitTraffic,
  variationNameProblem,
} from './experiment';

describe('flagKeyProblem', () => {
  it('accepts FX-style keys', () => {
    expect(flagKeyProblem('cms_savings')).toBeNull();
    expect(flagKeyProblem('hero-copy_2')).toBeNull();
  });

  it('rejects empty, invalid characters and the site URL separator', () => {
    expect(flagKeyProblem('')).toMatch(/Required/);
    expect(flagKeyProblem('has space')).toMatch(/letters/);
    expect(flagKeyProblem('a--b')).toMatch(/--/);
    expect(flagKeyProblem('x'.repeat(65))).toMatch(/max 64/);
  });
});

describe('variationNameProblem', () => {
  it('accepts names the site can match exactly', () => {
    expect(variationNameProblem('business')).toBeNull();
    expect(variationNameProblem('new_visitor')).toBeNull();
  });

  it('rejects reserved FX keys, including control', () => {
    for (const name of ['off', 'on', 'control']) expect(variationNameProblem(name)).toMatch(/reserved/);
  });

  it('rejects names that are not valid FX keys or contain --', () => {
    expect(variationNameProblem('Black Friday')).toMatch(/Rename/);
    expect(variationNameProblem('a--b')).toMatch(/--/);
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
    expect(experimentKeys(['business', 'control', 'personal'])).toEqual(['control', 'business', 'personal']);
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

  it('turns a public URL into a clean route', () => {
    expect(defaultRoute('https://site.example/savings/')).toBe('/savings');
    expect(defaultRoute('https://site.example/')).toBe('/');
    expect(defaultRoute('/investments/')).toBe('/investments');
    expect(defaultRoute(undefined)).toBe('');
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
