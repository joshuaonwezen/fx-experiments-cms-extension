import {
  CMS_FLAG_VARIABLE,
  CMS_ROUTE_VARIABLE,
  CONTROL_VARIATION_KEY,
  FULL_TRAFFIC,
  FX_APP_BASE,
} from '../../shared/constants';
import {splitTraffic} from '../../shared/experiment';
import type {FxEvent, RuleSummary, RunningExperiment} from '../../shared/types';
import {ApiError, requestJson} from './http';

const FLAGS_API = 'https://api.optimizely.com/flags/v1';
const V2_API = 'https://api.optimizely.com/v2';

export interface FxConfig {
  token: string;
  projectId: string;
  environmentKey: string;
  audienceIds: number[];
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
  metrics?: FxMetric[];
  variations: Record<string, {key: string; name: string; percentage_included: number}>;
  fetch_results_ui_url?: string;
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

  public get audienceIds(): number[] {
    return this.cfg.audienceIds;
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
  public async createFlag(flagKey: string, name: string, description: string, route: string): Promise<FxFlag> {
    const flag = await this.request<FxFlag>('Create flag', `${this.flagsBase}/flags`, {
      method: 'POST',
      body: JSON.stringify({
        key: flagKey,
        name,
        description,
        variable_definitions: {
          [CMS_FLAG_VARIABLE]: {key: CMS_FLAG_VARIABLE, type: 'boolean', default_value: 'true'},
          [CMS_ROUTE_VARIABLE]: {key: CMS_ROUTE_VARIABLE, type: 'string', default_value: route},
        },
      }),
    });
    return flag as FxFlag;
  }

  /** Points the flag at a new route by replacing the cms_route default. */
  public async setRouteDefault(flagKey: string, route: string): Promise<void> {
    await this.request('Update flag route', `${this.flagsBase}/flags`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json-patch+json'},
      body: JSON.stringify([
        {op: 'replace', path: `/${flagKey}/variable_definitions/${CMS_ROUTE_VARIABLE}/default_value`, value: route},
      ]),
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

  /** Adds an A/B rule splitting traffic evenly over control + `variationKeys`. */
  public async addAbRule(
    flagKey: string,
    ruleKey: string,
    name: string,
    variations: Array<{key: string; name: string}>,
    metrics: FxMetric[],
    trafficPercent: number,
  ): Promise<FxRuleset> {
    const names = new Map(variations.map((v) => [v.key, v.name]));
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
          audience_conditions: audienceConditions(this.cfg.audienceIds),
          metrics,
          variations: ruleVariations(variations.map((v) => v.key), names),
        },
      },
    ]);
  }

  /** Re-splits the rule evenly over control + `variationKeys` (adds any new ones). */
  public async setRuleVariations(
    flagKey: string,
    ruleKey: string,
    variations: Array<{key: string; name: string}>,
  ): Promise<FxRuleset> {
    const names = new Map(variations.map((v) => [v.key, v.name]));
    return this.patchRuleset('Update rule variations', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/variations`, value: ruleVariations(variations.map((v) => v.key), names)},
    ]);
  }

  public async setRuleMetrics(flagKey: string, ruleKey: string, metrics: FxMetric[]): Promise<FxRuleset> {
    return this.patchRuleset('Update rule metrics', flagKey, [
      {op: 'replace', path: `/rules/${ruleKey}/metrics`, value: metrics},
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

function ruleVariations(keys: string[], names: Map<string, string>) {
  return Object.fromEntries(
    splitTraffic(keys).map(({key, weight}) => [
      key,
      {key, name: names.get(key) ?? key, percentage_included: weight},
    ]),
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

// Rule types that split visitors to measure something; deliveries and rollouts only serve.
const EXPERIMENT_RULE_TYPES = new Set(['a/b', 'multi_armed_bandit', 'contextual_multi_armed_bandit']);

/**
 * The experiments the site serves as CMS content right now in `environmentKey`: an
 * enabled experiment rule, in an enabled environment, on a flag whose cms_flag default
 * is true (the site's middleware ignores flags without it).
 */
export function runningCmsExperiments(
  flags: FxFlagListItem[],
  environmentKey: string,
  flagUrl: (flagKey: string) => string,
): RunningExperiment[] {
  return flags.flatMap((flag) => {
    const env = flag.environments?.[environmentKey];
    const cmsFlag = flag.variable_definitions?.[CMS_FLAG_VARIABLE]?.default_value;
    if (flag.archived || !env?.enabled || String(cmsFlag).toLowerCase() !== 'true') return [];
    return (env.rules_detail ?? [])
      .filter((rule) => EXPERIMENT_RULE_TYPES.has(rule.type) && rule.enabled)
      .map((rule) => ({
        flagKey: flag.key,
        flagName: flag.name,
        ruleKey: rule.key,
        ruleName: rule.name || rule.key,
        route: flag.variable_definitions?.[CMS_ROUTE_VARIABLE]?.default_value ?? '',
        flagUrl: flagUrl(flag.key),
      }));
  });
}

/** The UI-facing view of one rule. */
export function summarizeRule(
  flag: FxFlag,
  ruleKey: string,
  rule: FxRule,
  ruleset: FxRuleset,
  environmentKey: string,
  flagUrl: string,
): RuleSummary {
  const variations = Object.values(rule.variations ?? {}).map((v) => ({
    key: v.key,
    name: v.name,
    percent: v.percentage_included / (FULL_TRAFFIC / 100),
  }));
  // Control first, then by name, so the table reads baseline → challengers.
  variations.sort((a, b) =>
    a.key === CONTROL_VARIATION_KEY ? -1 : b.key === CONTROL_VARIATION_KEY ? 1 : a.key.localeCompare(b.key),
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
    route: flag.variable_definitions?.[CMS_ROUTE_VARIABLE]?.default_value ?? '',
    resultsUrl: rule.fetch_results_ui_url ?? null,
    flagUrl,
  };
}
