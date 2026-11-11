import {FULL_TRAFFIC, FX_APP_BASE} from '../../shared/constants';
import type {Arm} from '../../shared/experiment';
import type {SiteProfile} from '../../shared/profile';
import type {FxEvent, RuleSummary, RunningExperiment} from '../../shared/types';
import {ApiError, requestJson} from './http';
import type {RawResults} from './results';

const FLAGS_API = 'https://api.optimizely.com/flags/v1';
const V2_API = 'https://api.optimizely.com/v2';

export interface FxConfig {
  token: string;
  projectId: string;
  environmentKey: string;
  /** The site's SDK key; its datafile is what visitors are decided from. '' on installs saved before it existed. */
  sdkKey: string;
}

interface FxVariableDefinition {
  key: string;
  type: string;
  default_value: string;
}

export interface FxFlag {
  key: string;
  name: string;
  description?: string;
  archived?: boolean;
  variable_definitions?: Record<string, FxVariableDefinition>;
}

/** A flag as the list endpoint returns it: variables plus a rule summary per environment. */
export interface FxFlagListItem extends FxFlag {
  environments?: Record<
    string,
    {
      enabled?: boolean;
      rules_detail?: Array<{key: string; name?: string; type: string; enabled?: boolean; status?: string}>;
    }
  >;
}

export interface FxVariation {
  key: string;
  name: string;
  archived?: boolean;
  variables?: Record<string, {key: string; type: string; value: string; is_default?: boolean}>;
}

export interface FxMetric {
  event_id: number;
  event_type: string;
  scope: string;
  aggregator: string;
  winning_direction: string;
  display_title?: string;
}

export interface FxRule {
  key: string;
  name?: string;
  type: string;
  enabled?: boolean;
  status?: string;
  archived?: boolean;
  percentage_included: number;
  audience_conditions?: unknown;
  metrics?: FxMetric[];
  variations: Record<string, {key: string; name: string; percentage_included: number}>;
  fetch_results_ui_url?: string;
  /** FX's experiment id for the rule; set once the rule has started. */
  layer_experiment_id?: number | null;
}

export interface FxRuleset {
  enabled: boolean;
  rules: Record<string, FxRule>;
  rule_priorities?: string[];
}

interface Page<T> {
  items?: T[];
  total_pages?: number;
}

type PatchOp = {op: 'add' | 'replace' | 'remove'; path: string; value?: unknown};

export class FxClient {
  private readonly cfg: FxConfig;

  public constructor(cfg: FxConfig) {
    this.cfg = cfg;
  }

  public get environmentKey(): string {
    return this.cfg.environmentKey;
  }

  public get projectId(): string {
    return this.cfg.projectId;
  }

  public get sdkKey(): string {
    return this.cfg.sdkKey;
  }

  /** The same client aimed at another environment - a link keeps the one it was created in. */
  public forEnvironment(environmentKey: string): FxClient {
    return environmentKey === this.cfg.environmentKey ? this : new FxClient({...this.cfg, environmentKey});
  }

  private request<T>(label: string, url: string, init: RequestInit = {}) {
    return requestJson<T>('fx', label, url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }

  private get flagsBase() {
    return `${FLAGS_API}/projects/${this.cfg.projectId}`;
  }

  private rulesetUrl(flagKey: string) {
    return `${this.flagsBase}/flags/${flagKey}/environments/${this.cfg.environmentKey}/ruleset`;
  }

  /** Lists the project's environments; used to validate settings. */
  public async listEnvironments(): Promise<string[]> {
    const page = await this.request<Page<{key: string}>>('List environments', `${this.flagsBase}/environments`);
    return (page?.items ?? []).map((e) => e.key);
  }

  /** Every active flag in the project, in one request per 100 flags. */
  public async listFlags(): Promise<FxFlagListItem[]> {
    const flags: FxFlagListItem[] = [];
    // The Flags API pages with page_window; it rejects `page` with a 400.
    for (let page = 1; page <= 10; page++) {
      const batch = await this.request<Page<FxFlagListItem>>(
        'List flags',
        `${this.flagsBase}/flags?per_page=100&page_window=${page}&archived=false`,
      );
      flags.push(...(batch?.items ?? []).filter((f) => !f.archived));
      if (!batch?.total_pages || page >= batch.total_pages) break;
    }
    return flags;
  }

  public async getFlag(flagKey: string): Promise<FxFlag | null> {
    try {
      return await this.request<FxFlag>('Get flag', `${this.flagsBase}/flags/${flagKey}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Creates a flag whose variable DEFAULTS mark it as CMS-driven for `route`. Defaults,
   * not per-variation values, so a variation someone later adds in the FX UI is still
   * picked up by the site's middleware (the existing `homepage` flag works the same way).
   */
  public async createFlag(
    flagKey: string,
    name: string,
    description: string,
    route: string,
    profile: SiteProfile,
  ): Promise<FxFlag> {
    const {markerVariable, routeVariable} = profile;
    const flag = await this.request<FxFlag>('Create flag', `${this.flagsBase}/flags`, {
      method: 'POST',
      body: JSON.stringify({
        key: flagKey,
        name,
        description,
        variable_definitions: {
          [markerVariable]: {key: markerVariable, type: 'boolean', default_value: 'true'},
          [routeVariable]: {key: routeVariable, type: 'string', default_value: route},
        },
      }),
    });
    return flag as FxFlag;
  }

  /** Points the flag at a new route by replacing the route variable's default. */
  public async setRouteDefault(flagKey: string, routeVariable: string, route: string): Promise<void> {
    await this.request('Update flag route', `${this.flagsBase}/flags`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json-patch+json'},
      body: JSON.stringify([
        {op: 'replace', path: `/${flagKey}/variable_definitions/${routeVariable}/default_value`, value: route},
      ]),
    });
  }

  /** Archives the flag in every environment. */
  public async archiveFlag(flagKey: string): Promise<void> {
    await this.request('Archive flag', `${this.flagsBase}/flags/archived`, {
      method: 'POST',
      body: JSON.stringify({keys: [flagKey]}),
    });
  }

  public async listVariations(flagKey: string): Promise<FxVariation[]> {
    const page = await this.request<Page<FxVariation>>(
      'List variations',
      `${this.flagsBase}/flags/${flagKey}/variations?per_page=100`,
    );
    return (page?.items ?? []).filter((v) => !v.archived);
  }

  public async createVariation(flagKey: string, key: string, name: string): Promise<void> {
    await this.request('Create variation', `${this.flagsBase}/flags/${flagKey}/variations`, {
      method: 'POST',
      body: JSON.stringify({key, name}),
    });
  }

  public async getRuleset(flagKey: string): Promise<FxRuleset> {
    const ruleset = await this.request<FxRuleset>('Get ruleset', this.rulesetUrl(flagKey));
    return ruleset ?? {enabled: false, rules: {}};
  }

  private async patchRuleset(label: string, flagKey: string, ops: PatchOp[]): Promise<FxRuleset> {
    const ruleset = await this.request<FxRuleset>(label, this.rulesetUrl(flagKey), {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json-patch+json'},
      body: JSON.stringify(ops),
    });
    return ruleset ?? this.getRuleset(flagKey);
  }

  /** Adds an A/B rule over `arms` (weights in basis points). */
  public async addAbRule(
    flagKey: string,
    ruleKey: string,
    name: string,
    arms: Array<Arm & {name: string}>,
    metrics: FxMetric[],
    trafficPercent: number,
    audienceIds: number[],
  ): Promise<FxRuleset> {
    return this.patchRuleset('Add A/B rule', flagKey, [
      {
        op: 'add',
        path: `/rules/${ruleKey}`,
        value: {
          key: ruleKey,
          name,
          type: 'a/b',
          distribution_mode: 'manual',
          percentage_included: toBasisPoints(trafficPercent),
          audience_conditions: audienceConditions(audienceIds),
          metrics,
          variations: ruleVariations(arms),
        },
      },
    ]);
  }

  /** Replaces the rule's arms and their weights. */
  public async setRuleArms(flagKey: string, ruleKey: string, arms: Array<Arm & {name: string}>): Promise<FxRuleset> {
    return this.patchRuleset('Update rule variations', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/variations`, value: ruleVariations(arms)},
    ]);
  }

  public async setRuleMetrics(flagKey: string, ruleKey: string, metrics: FxMetric[]): Promise<FxRuleset> {
    return this.patchRuleset('Update rule metrics', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/metrics`, value: metrics},
    ]);
  }

  public async setRuleTraffic(flagKey: string, ruleKey: string, trafficPercent: number): Promise<FxRuleset> {
    return this.patchRuleset('Update rule traffic', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/percentage_included`, value: toBasisPoints(trafficPercent)},
    ]);
  }

  public async setRuleAudiences(flagKey: string, ruleKey: string, audienceIds: number[]): Promise<FxRuleset> {
    return this.patchRuleset('Update rule audiences', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/audience_conditions`, value: audienceConditions(audienceIds)},
    ]);
  }

  /**
   * Starts or pauses the rule. Starting also enables the flag's ruleset in this
   * environment - a rule inside a disabled ruleset serves nothing.
   */
  public async setRuleRunning(flagKey: string, ruleKey: string, running: boolean): Promise<FxRuleset> {
    let ruleset = await this.patchRuleset(running ? 'Start rule' : 'Pause rule', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/enabled`, value: running},
    ]);
    if (running && !ruleset.enabled) {
      await this.request('Enable ruleset', `${this.rulesetUrl(flagKey)}/enabled`, {method: 'POST'});
      ruleset = await this.getRuleset(flagKey);
    }
    return ruleset;
  }

  /**
   * Adds a targeted delivery that serves one variation to everyone in `audienceIds`
   * (every visitor when empty). The Flags API creates rules disabled; the caller starts it.
   */
  public async addDeliveryRule(
    flagKey: string,
    ruleKey: string,
    name: string,
    variation: {key: string; name: string},
    audienceIds: number[],
  ): Promise<FxRuleset> {
    return this.patchRuleset('Add delivery rule', flagKey, [
      {
        op: 'add',
        path: `/rules/${ruleKey}`,
        value: {
          key: ruleKey,
          name,
          type: 'targeted_delivery',
          percentage_included: FULL_TRAFFIC,
          audience_conditions: audienceConditions(audienceIds),
          variations: {[variation.key]: {key: variation.key, name: variation.name, percentage_included: FULL_TRAFFIC}},
        },
      },
    ]);
  }

  /** The project's custom events, archived ones excluded. */
  public async listEvents(): Promise<FxEvent[]> {
    const events: FxEvent[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.request<Array<{id: number; key: string; name?: string; archived?: boolean}>>(
        'List events',
        `${V2_API}/events?project_id=${this.cfg.projectId}&include_classic=false&per_page=100&page=${page}`,
      );
      const items = batch ?? [];
      for (const e of items) {
        if (!e.archived) events.push({id: e.id, key: e.key, name: e.name || e.key});
      }
      if (items.length < 100) break;
    }
    return events.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async createEvent(key: string, name: string): Promise<FxEvent> {
    const event = await this.request<{id: number; key: string; name?: string}>(
      'Create event',
      `${V2_API}/projects/${this.cfg.projectId}/custom_events`,
      {method: 'POST', body: JSON.stringify({key, name, category: 'other'})},
    );
    if (!event) throw new ApiError(502, 'fx_unavailable', 'Create event: empty response');
    return {id: event.id, key: event.key, name: event.name || event.key};
  }

  /** The rule's results as FX computes them (by its layer_experiment_id). */
  public async experimentResults(experimentId: string): Promise<RawResults | null> {
    return this.request<RawResults>('FX results', `${V2_API}/experiments/${encodeURIComponent(experimentId)}/results`);
  }

  public flagUrl(flagKey: string): string {
    return `${FX_APP_BASE}/projects/${this.cfg.projectId}/flags/manage/${flagKey}/rules/${this.cfg.environmentKey}`;
  }
}

function toBasisPoints(percent: number): number {
  const clamped = Math.min(100, Math.max(1, Math.round(percent)));
  return clamped * (FULL_TRAFFIC / 100);
}

function audienceConditions(ids: number[]): unknown[] {
  return ids.length > 0 ? ['or', ...ids.map((id) => ({audience_id: id}))] : [];
}

/** The audience ids anywhere in a rule's audience_conditions tree. */
export function audienceIdsOf(conditions: unknown): number[] {
  const found = new Set<number>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'audience_id' in node) {
      const id = Number((node as {audience_id: unknown}).audience_id);
      if (Number.isSafeInteger(id) && id > 0) found.add(id);
    }
  };
  walk(conditions);
  return [...found];
}

function ruleVariations(arms: Array<Arm & {name: string}>) {
  return Object.fromEntries(
    arms.map(({key, name, weight}) => [key, {key, name, percentage_included: weight}]),
  );
}

/** Uniform visitor-scoped conversion metric, same shape as the live rules use. */
export function metricFor(event: FxEvent): FxMetric {
  return {
    event_id: event.id,
    event_type: 'custom',
    scope: 'visitor',
    aggregator: 'unique',
    winning_direction: 'increasing',
    display_title: event.name,
  };
}

// Rule types that split visitors to measure something.
const EXPERIMENT_RULE_TYPES = new Set(['a/b', 'multi_armed_bandit', 'contextual_multi_armed_bandit']);
const DELIVERY_RULE_TYPES = new Set(['targeted_delivery', 'rollout']);

/**
 * Fallback for installs without an SDK key: the live CMS rules as far as the Flags API
 * list shows them. It sees only variable defaults, so a flag that switches the marker
 * on per variation is missed; the datafile (liveCmsRules) has no such gap.
 */
export function runningCmsExperiments(
  flags: FxFlagListItem[],
  environmentKey: string,
  profile: SiteProfile,
  flagUrl: (flagKey: string) => string,
): RunningExperiment[] {
  return flags.flatMap((flag) => {
    const env = flag.environments?.[environmentKey];
    const marker = flag.variable_definitions?.[profile.markerVariable];
    if (flag.archived || !env?.enabled || marker?.type !== 'boolean') return [];
    if (String(marker.default_value).toLowerCase() !== 'true') return [];
    return (env.rules_detail ?? [])
      .filter((rule) => rule.enabled && (EXPERIMENT_RULE_TYPES.has(rule.type) || DELIVERY_RULE_TYPES.has(rule.type)))
      .map((rule) => ({
        flagKey: flag.key,
        flagName: flag.name,
        ruleKey: rule.key,
        ruleName: rule.name || rule.key,
        kind: EXPERIMENT_RULE_TYPES.has(rule.type) ? ('experiment' as const) : ('delivery' as const),
        route: flag.variable_definitions?.[profile.routeVariable]?.default_value ?? '',
        variations: [],
        flagUrl: flagUrl(flag.key),
      }));
  });
}

/**
 * The route the site applies `armKeys` on: each arm's override of the route variable, or
 * the default. A blank value anywhere means every route.
 */
export function effectiveRoute(
  flag: FxFlag,
  variations: FxVariation[],
  armKeys: string[],
  routeVariable: string,
): {route: string; perVariation: boolean} {
  const fallback = flag.variable_definitions?.[routeVariable]?.default_value ?? '';
  let perVariation = false;
  const routes = armKeys.map((key) => {
    const own = variations.find((v) => v.key === key)?.variables?.[routeVariable];
    if (own && own.is_default === false) {
      perVariation = true;
      return own.value.trim();
    }
    return fallback.trim();
  });
  const unique = [...new Set(routes.length > 0 ? routes : [fallback.trim()])];
  return {route: unique.includes('') ? '' : unique.join(', '), perVariation};
}

/** The UI-facing view of one rule. */
export function summarizeRule(
  flag: FxFlag,
  ruleKey: string,
  rule: FxRule,
  ruleset: FxRuleset,
  environmentKey: string,
  flagUrl: string,
  profile: SiteProfile,
  flagVariations: FxVariation[],
): RuleSummary {
  const variations = Object.values(rule.variations ?? {}).map((v) => ({
    key: v.key,
    name: v.name,
    percent: v.percentage_included / (FULL_TRAFFIC / 100),
  }));
  // Control first, then by name, so the table reads baseline → challengers.
  variations.sort((a, b) =>
    a.key === profile.controlKey ? -1 : b.key === profile.controlKey ? 1 : a.key.localeCompare(b.key),
  );
  const {route, perVariation} = effectiveRoute(
    flag,
    flagVariations,
    variations.map((v) => v.key).filter((k) => k !== 'off'),
    profile.routeVariable,
  );
  return {
    flagKey: flag.key,
    flagName: flag.name,
    ruleKey,
    environmentKey,
    status: rule.status ?? (rule.enabled ? 'running' : 'draft'),
    running: Boolean(rule.enabled && ruleset.enabled),
    trafficPercent: rule.percentage_included / (FULL_TRAFFIC / 100),
    variations,
    metrics: (rule.metrics ?? []).map((m) => ({eventId: m.event_id, title: m.display_title ?? String(m.event_id)})),
    audienceIds: audienceIdsOf(rule.audience_conditions),
    route,
    routePerVariation: perVariation,
    resultsUrl: rule.fetch_results_ui_url ?? null,
    experimentId: rule.layer_experiment_id ? String(rule.layer_experiment_id) : null,
    flagUrl,
  };
}

/** The rule's arms with their current weights (basis points), in rule order. */
export function armsOf(rule: FxRule): Array<Arm & {name: string}> {
  return Object.values(rule.variations ?? {}).map((v) => ({key: v.key, name: v.name, weight: v.percentage_included}));
}
