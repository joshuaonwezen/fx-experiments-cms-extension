// The contract between the UI bundles and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

export type Envelope<T> =
  | {ok: true; result: T}
  | {ok: false; error: string; message?: string};

export interface ContentRef {
  key: string;
  locale: string;
  version?: string;
  publicUrl?: string;
}

export interface CmsVariation {
  name: string;
  /** published if any version is published, else draft, else previous. */
  status: string;
}

export interface FxEvent {
  id: number;
  key: string;
  name: string;
}

export interface MetricSummary {
  eventId: number;
  title: string;
}

export interface ExperimentLink {
  contentKey: string;
  locale: string;
  flagKey: string;
  ruleKey: string;
  environmentKey: string;
  route: string;
  displayName: string;
  createdAt: string;
}

export interface RuleSummary {
  flagKey: string;
  flagName: string;
  ruleKey: string;
  environmentKey: string;
  /** FX rule status as reported by the Flags API, e.g. draft / running / paused. */
  status: string;
  running: boolean;
  /** Share of the audience in the experiment, 0-100. */
  trafficPercent: number;
  variations: Array<{key: string; name: string; percent: number}>;
  metrics: MetricSummary[];
  /** cms_route default on the flag. */
  route: string;
  resultsUrl: string | null;
  flagUrl: string;
}

/**
 * A running experiment on a CMS-driven flag (cms_flag on) in this environment. The site
 * buckets a visitor into every such flag whose cms_route covers the page, but the page
 * can only show one variation, so two on the same page muddy each other's results.
 */
export interface RunningExperiment {
  flagKey: string;
  flagName: string;
  ruleKey: string;
  ruleName: string;
  /** The flag's cms_route default; '' covers every route. */
  route: string;
  flagUrl: string;
}

export interface VariationDiff {
  /** CMS variations the FX flag doesn't have yet. */
  missingInFx: string[];
  /** FX variations (besides control/off/on) with no CMS variation of that name. */
  missingInCms: string[];
  /** CMS variation names that can't be FX keys, with the reason. */
  invalid: Array<{name: string; reason: string}>;
}

export interface StatusResult {
  content: {
    key: string;
    locale: string;
    displayName: string;
    currentVariation: string | null;
    suggestedFlagKey: string;
    suggestedRoute: string;
  };
  cmsVariations: CmsVariation[];
  link: ExperimentLink | null;
  rule: RuleSummary | null;
  /** Set when the link points at a flag/rule FX no longer has. */
  ruleError: string | null;
  diff: VariationDiff;
  /**
   * Running experiments on other CMS flags (this page's own flag excluded), whatever
   * their route; the UI filters them by the route in play. Null when FX couldn't be checked.
   */
  runningExperiments: RunningExperiment[] | null;
  settings: {projectId: string; environmentKey: string; audienceIds: number[]};
}

export interface CreateExperimentParams {
  content: ContentRef;
  displayName: string;
  flagKey: string;
  flagName: string;
  route: string;
  variations: string[];
  eventIds: number[];
  trafficPercent: number;
  start: boolean;
  /** Start even when another experiment runs on an overlapping route. */
  confirmConflicts?: boolean;
}

export interface ExperimentRow {
  link: ExperimentLink;
  rule: RuleSummary | null;
  error: string | null;
}

export type ActionParams = {
  getStatus: {content: ContentRef};
  listEvents: Record<string, never>;
  createEvent: {key: string; name: string};
  createExperiment: CreateExperimentParams;
  syncVariations: {content: ContentRef; confirmRunning: boolean};
  setMetrics: {content: ContentRef; eventIds: number[]};
  setRunning: {content: ContentRef; running: boolean; confirmConflicts?: boolean};
  setRoute: {content: ContentRef; route: string};
  linkExisting: {content: ContentRef; displayName: string; flagKey: string; ruleKey?: string};
  unlink: {content: ContentRef};
  listExperiments: Record<string, never>;
};

export type ActionResults = {
  getStatus: StatusResult;
  listEvents: FxEvent[];
  createEvent: FxEvent;
  createExperiment: StatusResult;
  syncVariations: StatusResult;
  setMetrics: StatusResult;
  setRunning: StatusResult;
  setRoute: StatusResult;
  linkExisting: StatusResult;
  unlink: StatusResult;
  listExperiments: ExperimentRow[];
};

export type ActionName = keyof ActionParams;
