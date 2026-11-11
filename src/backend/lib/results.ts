import type {ExperimentResults, VariationResult} from '../../shared/types';

// FX results for the sidebar, from GET /v2/experiments/{layer_experiment_id}/results.
// That endpoint serves FX rules as well as Web experiments; it answers 400 "Invalid
// experiment configuration" for a rule FX cannot compute results for yet, which the
// caller shows as a note rather than an error.

interface RawVariation {
  name?: string;
  samples?: number;
  rate?: number | null;
  is_baseline?: boolean;
  lift?: {value?: number; is_significant?: boolean} | null;
}

export interface RawResults {
  last_calculated_time?: string;
  metrics?: Array<{name?: string; winning_direction?: string; results?: Record<string, RawVariation>}>;
  reach?: {total_count?: number};
}

/**
 * The primary (first) metric, baseline first, with each FX variation name mapped back
 * to its key. The leader is a variation whose lift is significant in the metric's
 * winning direction; with several, the biggest lift.
 */
export function summarizeResults(raw: RawResults | null, keyByName: Map<string, string>): ExperimentResults | null {
  const metric = raw?.metrics?.[0];
  if (!metric?.results) return null;
  const decreasing = metric.winning_direction === 'decreasing';
  const variations: VariationResult[] = Object.values(metric.results)
    .map((v) => ({
      key: keyByName.get(v.name ?? '') ?? null,
      name: v.name ?? '',
      isBaseline: v.is_baseline === true,
      samples: v.samples ?? 0,
      rate: typeof v.rate === 'number' ? v.rate : null,
      lift: typeof v.lift?.value === 'number' ? v.lift.value : null,
      significant: v.lift?.is_significant === true,
    }))
    .sort((a, b) => Number(b.isBaseline) - Number(a.isBaseline));
  const better = (v: VariationResult) => v.lift !== null && (decreasing ? v.lift < 0 : v.lift > 0);
  const leader = variations
    .filter((v) => !v.isBaseline && v.significant && better(v))
    .sort((a, b) => Math.abs(b.lift!) - Math.abs(a.lift!))[0];
  return {
    metric: metric.name ?? 'Primary metric',
    lastCalculated: raw?.last_calculated_time ?? null,
    visitors: raw?.reach?.total_count ?? variations.reduce((n, v) => n + v.samples, 0),
    variations,
    leader: leader?.key ?? null,
  };
}
