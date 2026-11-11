// The contract between the UI bundles and the cms_extension function. The UI sends
// {action, params}; the function answers with an Envelope.

import type {SiteProfile} from './profile';

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

export interface AudienceOption {
  id: number;
  name: string;
}

export interface MetricSummary {
  eventId: number;
  title: string;
}

/** How an ended experiment's winner reached visitors. */
export type ShipVia = 'fx' | 'cms';

export interface Conclusion {
  endedAt: string;
  /** The winning FX variation key, or null for "no winner" (keep the original page). */
  winner: string | null;
  /** Null when nothing had to ship: no winner, or the control (original page) won. */
  shipVia: ShipVia | null;
  /** FX: the targeted delivery serving the winner. */
  deliveryRuleKey?: string;
  /** CMS: the base version the winner was copied into, and whether it went live. */
  promotedVersion?: string;
  promotion?: 'published' | 'awaiting_approval';
  /** CMS variations deleted after the test, and versions the CMS refused to delete. */
  deleted?: string[];
  notDeleted?: Array<{name: string; version: string; reason: string}>;
  archived?: boolean;
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
  conclusion?: Conclusion;
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
  audienceIds: number[];
  /**
   * The route the site applies the flag on: the route variable's value, including any
   * per-variation override. '' covers every route.
   */
  route: string;
  /** Some variations override the route variable, so editing the default would not move them. */
  routePerVariation: boolean;
  resultsUrl: string | null;
  flagUrl: string;
}

/**
 * A live rule on another CMS-driven flag. The site buckets a visitor into every such
 * flag whose route covers the page, but the page shows one variation, so a second one
 * muddies the experiment: another experiment, or a delivery (personalization) that
 * swaps the content for some visitors.
 */
export interface RunningExperiment {
  flagKey: string;
  flagName: string;
  ruleKey: string;
  ruleName: string;
  kind: 'experiment' | 'delivery';
  /** Route the rule's served variations apply on; '' covers every route. */
  route: string;
  /** CMS variation keys the rule serves. */
  variations: string[];
  flagUrl: string;
}

export interface VariationDiff {
  /** CMS variations the FX flag doesn't have yet. */
  missingInFx: string[];
  /** FX arms (besides control/off/on) with no CMS variation of that name. */
  missingInCms: string[];
  /** FX arms whose CMS variation exists but has no published version: visitors there see the original. */
  unpublished: string[];
  /** CMS variation names that can't be FX keys, with the reason. */
  invalid: Array<{name: string; reason: string}>;
}

/** A variation the end-of-test cleanup would delete, with the versions that go with it. */
export interface DeleteCandidate {
  name: string;
  versions: Array<{version: string; status: string}>;
}

export interface StatusResult {
  content: {
    key: string;
    locale: string;
    displayName: string;
    currentVariation: string | null;
    basePublished: boolean;
    suggestedFlagKey: string;
    suggestedRoute: string;
    /** The paths visitors request this page on (per the site profile). */
    visitorPaths: string[];
  };
  cmsVariations: CmsVariation[];
  link: ExperimentLink | null;
  rule: RuleSummary | null;
  /** Set when the link points at a flag/rule FX no longer has. */
  ruleError: string | null;
  diff: VariationDiff;
  /**
   * Live rules on other CMS flags (this page's own A/B rule excluded), whatever their
   * route; the UI filters them by the route in play. Null when FX couldn't be checked.
   */
  runningExperiments: RunningExperiment[] | null;
  /** Whether the site's datafile already serves the linked rule; null when there's no SDK key to check. */
  liveOnSite: boolean | null;
  /** Variations the cleanup step would delete; only once the experiment has ended. */
  deleteCandidates: DeleteCandidate[];
  settings: {
    projectId: string;
    environmentKey: string;
    allowDelete: boolean;
    profile: SiteProfile;
  };
}

export interface CreateExperimentParams {
  content: ContentRef;
  displayName: string;
  flagKey: string;
  flagName: string;
  route: string;
  variations: string[];
  eventIds: number[];
  audienceIds: number[];
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

export interface CmsFlagOption {
  flagKey: string;
  name: string;
  rules: Array<{key: string; name: string; enabled: boolean}>;
  linked: boolean;
}

export type ActionParams = {
  getStatus: {content: ContentRef};
  listEvents: Record<string, never>;
  createEvent: {key: string; name: string};
  listAudiences: Record<string, never>;
  listCmsFlags: Record<string, never>;
  createExperiment: CreateExperimentParams;
  syncVariations: {content: ContentRef; confirmRunning: boolean};
  removeVariations: {content: ContentRef; variations: string[]; confirmRunning: boolean};
  setMetrics: {content: ContentRef; eventIds: number[]};
  setTraffic: {content: ContentRef; trafficPercent: number};
  setAudiences: {content: ContentRef; audienceIds: number[]};
  setRunning: {content: ContentRef; running: boolean; confirmConflicts?: boolean};
  setRoute: {content: ContentRef; route: string};
  linkExisting: {content: ContentRef; displayName: string; flagKey: string; ruleKey?: string};
  unlink: {content: ContentRef; confirmRunning?: boolean};
  endExperiment: {content: ContentRef; winner: string | null; shipVia: ShipVia | null};
  deleteVariations: {content: ContentRef; confirm: string[]};
  archiveFlag: {content: ContentRef};
  listExperiments: Record<string, never>;
  forgetLink: {contentKey: string; locale: string};
};

export type ActionResults = {
  getStatus: StatusResult;
  listEvents: FxEvent[];
  createEvent: FxEvent;
  listAudiences: AudienceOption[];
  listCmsFlags: CmsFlagOption[];
  createExperiment: StatusResult;
  syncVariations: StatusResult;
  removeVariations: StatusResult;
  setMetrics: StatusResult;
  setTraffic: StatusResult;
  setAudiences: StatusResult;
  setRunning: StatusResult;
  setRoute: StatusResult;
  linkExisting: StatusResult;
  unlink: StatusResult;
  endExperiment: StatusResult;
  deleteVariations: StatusResult;
  archiveFlag: StatusResult;
  listExperiments: ExperimentRow[];
  forgetLink: ExperimentRow[];
};

export type ActionName = keyof ActionParams;
