import {describe, expect, it} from 'vitest';

import {summarizeResults} from './results';

// Shape of GET /v2/experiments/{id}/results (cms_personal_banking_experiment, 2026-11-11), with numbers filled in.
const keys = new Map([
  ['Control (original page)', 'control'],
  ['business', 'business'],
  ['personal', 'personal'],
]);
const raw = (direction: string, lifts: Record<string, [number, boolean]>) => ({
  last_calculated_time: '2026-11-11T07:00:00Z',
  reach: {total_count: 900},
  metrics: [
    {
      name: 'mb_cta_click',
      winning_direction: direction,
      results: {
        '1': {name: 'Control (original page)', samples: 300, rate: 0.1, is_baseline: true, lift: null},
        ...Object.fromEntries(
          Object.entries(lifts).map(([name, [value, sig]], i) => [
            String(i + 2),
            {name, samples: 300, rate: 0.1 * (1 + value), is_baseline: false, lift: {value, is_significant: sig}},
          ]),
        ),
      },
    },
  ],
});

describe('summarizeResults', () => {
  it('puts the baseline first and maps names back to keys', () => {
    const r = summarizeResults(raw('increasing', {business: [0.2, false]}), keys)!;
    expect(r.variations.map((v) => [v.key, v.isBaseline])).toEqual([
      ['control', true],
      ['business', false],
    ]);
    expect(r.visitors).toBe(900);
    expect(r.leader).toBeNull();
  });

  it('names the biggest significant lift in the winning direction', () => {
    expect(summarizeResults(raw('increasing', {business: [0.05, true], personal: [0.12, true]}), keys)!.leader).toBe('personal');
    // A significant drop is not a win when higher is better.
    expect(summarizeResults(raw('increasing', {business: [-0.3, true]}), keys)!.leader).toBeNull();
    // ...but it is when lower is better.
    expect(summarizeResults(raw('decreasing', {business: [-0.3, true]}), keys)!.leader).toBe('business');
  });

  it('returns null without results', () => {
    expect(summarizeResults(null, keys)).toBeNull();
    expect(summarizeResults({metrics: []}, keys)).toBeNull();
  });
});
