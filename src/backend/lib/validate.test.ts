import {describe, expect, it} from 'vitest';

import {contentRef, PARSERS} from './validate';

const KEY = '3525e1552b6f46158be2850ff6e6fb74';

describe('contentRef', () => {
  it('normalizes the key and keeps known fields only', () => {
    expect(
      contentRef({key: '3525E155-2b6f-4615-8be2-850ff6e6fb74', locale: 'en', version: '6882', publicUrl: 'https://x.example/', extra: 1}),
    ).toEqual({key: KEY, locale: 'en', version: '6882', publicUrl: 'https://x.example/'});
  });

  it('rejects values that would reach an API path', () => {
    expect(() => contentRef({key: '../../v1/contenttypes'})).toThrow(/content key/);
    expect(() => contentRef({key: KEY, version: '1/../2'})).toThrow(/version/);
    expect(() => contentRef({key: KEY, locale: 'en/../x'})).toThrow(/locale/);
    expect(() => contentRef({key: KEY, publicUrl: 'javascript:alert(1)'})).toThrow(/URL/);
  });
});

describe('PARSERS', () => {
  it('rejects flag and rule keys that would escape a URL or JSON Patch path', () => {
    const content = {key: KEY, locale: 'en'};
    expect(() => PARSERS.linkExisting({content, flagKey: 'homepage/../x'})).toThrow(/flagKey/);
    expect(() => PARSERS.linkExisting({content, flagKey: 'homepage', ruleKey: 'r/enabled'})).toThrow(/ruleKey/);
    expect(PARSERS.linkExisting({content, flagKey: 'homepage'})).toEqual({content, displayName: '', flagKey: 'homepage'});
  });

  it('checks event keys server-side', () => {
    expect(() => PARSERS.createEvent({key: 'has space'})).toThrow(/key/);
    expect(PARSERS.createEvent({key: 'mb_cta_click'})).toEqual({key: 'mb_cta_click', name: 'mb_cta_click'});
  });

  it('accepts only whole positive ids and 1-100 traffic', () => {
    const content = {key: KEY, locale: 'en'};
    expect(() => PARSERS.setMetrics({content, eventIds: [1.5]})).toThrow(/eventIds/);
    expect(() => PARSERS.setTraffic({content, trafficPercent: 0})).toThrow(/trafficPercent/);
    expect(PARSERS.setTraffic({content, trafficPercent: '50'})).toEqual({content, trafficPercent: 50});
  });

  it('allows only known ways to ship a winner', () => {
    const content = {key: KEY, locale: 'en'};
    expect(() => PARSERS.endExperiment({content, winner: 'business', shipVia: 'email'})).toThrow(/shipVia/);
    expect(PARSERS.endExperiment({content, winner: null})).toEqual({content, winner: null, shipVia: null});
  });
});
