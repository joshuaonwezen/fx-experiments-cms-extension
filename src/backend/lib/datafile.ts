import type {SiteProfile} from '../../shared/profile';
import type {AudienceOption, RunningExperiment} from '../../shared/types';
import {ApiError, requestJson} from './http';

// The site decides from the public datafile of its SDK key, so the datafile is the
// authority on what visitors get right now: only enabled rules are in it, and each
// variation carries its effective variable values (defaults or overrides).

const SDK_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const CACHE_MS = 30_000;

interface DatafileVariation {
  id: string;
  key: string;
  featureEnabled?: boolean;
  variables?: Array<{id: string; value: string}>;
}

interface DatafileRule {
  id: string;
  key: string;
  status?: string;
  variations: DatafileVariation[];
}

export interface Datafile {
  projectId: string;
  environmentKey: string;
  featureFlags: Array<{
    key: string;
    experimentIds: string[];
    rolloutId: string;
    variables: Array<{id: string; key: string; type: string; defaultValue: string}>;
  }>;
  experiments: DatafileRule[];
  rollouts: Array<{id: string; experiments: DatafileRule[]}>;
  audiences?: Array<{id: string; name: string}>;
  typedAudiences?: Array<{id: string; name: string}>;
}

export function isSdkKey(value: string): boolean {
  return SDK_KEY.test(value);
}

// Module scope survives warm invocations of the function.
const cache = new Map<string, {at: number; datafile: Datafile}>();

/** The site's datafile, cached briefly; the CDN itself caches for up to two minutes. */
export async function fetchDatafile(sdkKey: string, {fresh = false} = {}): Promise<Datafile> {
  if (!isSdkKey(sdkKey)) throw new ApiError(400, 'fx_rejected', 'SDK key: not a valid key.');
  const hit = cache.get(sdkKey);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.datafile;
  const datafile = await requestJson<Datafile>('fx', 'Datafile', `https://cdn.optimizely.com/datafiles/${sdkKey}.json`);
  if (!datafile?.projectId || !datafile.environmentKey) {
    throw new ApiError(502, 'fx_unavailable', 'Datafile: no projectId/environmentKey in the response.');
  }
  cache.set(sdkKey, {at: Date.now(), datafile});
  return datafile;
}

/** One live rule's CMS footprint, before the caller adds names and URLs. */
export interface LiveCmsRule {
  flagKey: string;
  ruleKey: string;
  kind: 'experiment' | 'delivery';
  route: string;
  variations: string[];
}

/**
 * Every live rule that makes the site serve CMS content: an enabled rule whose served
 * variations (feature on, marker variable true) carry a route. Mirrors the site's
 * middleware filter: enabled decision, not `off`, marker === true, route matches.
 */
export function liveCmsRules(datafile: Datafile, profile: SiteProfile): LiveCmsRule[] {
  const experiments = new Map(datafile.experiments.map((e) => [e.id, e]));
  const rollouts = new Map(datafile.rollouts.map((r) => [r.id, r]));
  const rules: LiveCmsRule[] = [];

  for (const flag of datafile.featureFlags) {
    const marker = flag.variables.find((v) => v.key === profile.markerVariable);
    const route = flag.variables.find((v) => v.key === profile.routeVariable);
    // The site reads the marker as a boolean; a string "true" never matches.
    if (!marker || marker.type !== 'boolean') continue;

    const valueOf = (variation: DatafileVariation, def: {id: string; defaultValue: string} | undefined) =>
      def ? (variation.variables?.find((v) => v.id === def.id)?.value ?? def.defaultValue) : '';

    const consider = (rule: DatafileRule, kind: LiveCmsRule['kind']) => {
      if (rule.status && rule.status !== 'Running') return;
      const served = rule.variations.filter(
        (v) => v.featureEnabled && v.key !== 'off' && valueOf(v, marker).toLowerCase() === 'true',
      );
      if (served.length === 0) return;
      const routes = [...new Set(served.map((v) => valueOf(v, route).trim()))];
      rules.push({
        flagKey: flag.key,
        ruleKey: rule.key,
        kind,
        // A blank route anywhere means "every route".
        route: routes.includes('') ? '' : routes.join(', '),
        variations: served.map((v) => v.key),
      });
    };

    for (const id of flag.experimentIds) {
      const rule = experiments.get(id);
      if (rule) consider(rule, 'experiment');
    }
    for (const rule of rollouts.get(flag.rolloutId)?.experiments ?? []) consider(rule, 'delivery');
  }
  return rules;
}

/** Whether the site's datafile serves `ruleKey` on `flagKey` right now. */
export function isRuleLive(datafile: Datafile, flagKey: string, ruleKey: string): boolean {
  const flag = datafile.featureFlags.find((f) => f.key === flagKey);
  if (!flag) return false;
  const ids = new Set(flag.experimentIds);
  const inExperiments = datafile.experiments.some((e) => ids.has(e.id) && e.key === ruleKey && e.status === 'Running');
  const rollout = datafile.rollouts.find((r) => r.id === flag.rolloutId);
  return inExperiments || Boolean(rollout?.experiments.some((e) => e.key === ruleKey && e.status === 'Running'));
}

/** The project's audiences by name, without FX's internal placeholders. */
export function datafileAudiences(datafile: Datafile): AudienceOption[] {
  const byId = new Map<number, string>();
  for (const a of [...(datafile.audiences ?? []), ...(datafile.typedAudiences ?? [])]) {
    const id = Number(a.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (/^Optimizely-Generated/i.test(a.name)) continue;
    byId.set(id, a.name);
  }
  return [...byId.entries()].map(([id, name]) => ({id, name})).sort((a, b) => a.name.localeCompare(b.name));
}

/** The live rules as the UI shows them, with flag names and links filled in. */
export function toRunningExperiments(
  rules: LiveCmsRule[],
  flagName: (flagKey: string) => string,
  flagUrl: (flagKey: string) => string,
): RunningExperiment[] {
  return rules.map((r) => ({
    ...r,
    flagName: flagName(r.flagKey),
    ruleName: r.ruleKey,
    flagUrl: flagUrl(r.flagKey),
  }));
}
