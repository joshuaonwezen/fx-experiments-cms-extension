import {describe, expect, it} from 'vitest';

import {DEFAULT_PROFILE as P} from './profile';
import {blockers, readiness} from './readiness';

const base = {
  basePublished: true,
  arms: ['business'],
  cmsVariations: [{name: 'business', status: 'published'}],
  metricCount: 1,
  route: '/personal-banking, /en/personal-banking',
  visitorPaths: ['/personal-banking', '/en/personal-banking'],
  running: [],
  profile: P,
};

describe('readiness', () => {
  it('passes a ready experiment', () => {
    expect(readiness(base).every((i) => i.ok)).toBe(true);
  });

  it('blocks on an unpublished page or variation, warns on the rest', () => {
    const items = readiness({
      ...base,
      basePublished: false,
      cmsVariations: [{name: 'business', status: 'draft'}, {name: 'wx_hero', status: 'published'}],
      metricCount: 0,
      route: '/en/personal-banking',
      running: null,
    });
    expect(blockers(items)).toEqual(['Publish the original page first.', expect.stringContaining('Publish "business"')]);
    expect(items.filter((i) => !i.ok && !i.blocking).map((i) => i.key)).toEqual(['metric', 'route', 'clash', 'reserved']);
    expect(items.find((i) => i.key === 'route')?.text).toContain('/personal-banking');
  });

  it('counts a personalization delivery on the same page as a clash', () => {
    const delivery = {
      flagKey: 'homepage',
      flagName: 'homepage',
      ruleKey: 'business',
      ruleName: 'business',
      kind: 'delivery' as const,
      route: '/, /en',
      variations: ['business'],
      flagUrl: '',
    };
    const items = readiness({...base, route: '/', visitorPaths: ['/', '/en'], running: [delivery]});
    expect(items.find((i) => i.key === 'clash')).toMatchObject({ok: false, text: expect.stringContaining('personalization')});
  });
});
