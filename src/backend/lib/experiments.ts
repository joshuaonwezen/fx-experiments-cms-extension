import {logger} from '@zaiusinc/app-sdk';

import {CMS_FLAG_VARIABLE, CONTROL_VARIATION_KEY, RESERVED_VARIATION_KEYS} from '../../shared/constants';
import {
  defaultFlagKey,
  defaultRoute,
  experimentKeys,
  flagKeyProblem,
  normalizeKey,
  routeProblem,
  routesOverlap,
  variationNameProblem,
} from '../../shared/experiment';
import type {
  ActionParams,
  CmsVariation,
  ContentRef,
  CreateExperimentParams,
  ExperimentLink,
  ExperimentRow,
  RuleSummary,
  RunningExperiment,
  StatusResult,
  VariationDiff,
} from '../../shared/types';
import {CmsClient, summarizeVersions} from './cms';
import {FxClient, FxFlag, FxRule, FxRuleset, metricFor, runningCmsExperiments, summarizeRule} from './fx';
import {ApiError} from './http';
import {getLink, listLinks, removeLink, saveLink} from './links';

const CONTROL_NAME = 'Control (original page)';

/** A request the UI can fix (bad input, wrong state) - answered as HTTP 400. */
export class ActionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

export interface Deps {
  fx: FxClient;
  cms: CmsClient;
}

interface ResolvedContent {
  key: string;
  locale: string;
  displayName: string;
  variations: CmsVariation[];
  currentVariation: string | null;
  publicUrl?: string;
}

async function resolveContent({cms}: Deps, ref: ContentRef): Promise<ResolvedContent> {
  if (!ref?.key) throw new ActionError('missing_content', 'No content item is open.');
  const key = normalizeKey(ref.key);
  const locale = ref.locale || (await cms.primaryLocale(key));
  const versions = await cms.listVersions(key, locale);
  const {variations, displayName} = summarizeVersions(versions);

  let currentVariation: string | null = null;
  if (ref.version) {
    const listed = versions.find((v) => String(v.version) === String(ref.version));
    currentVariation = listed ? (listed.variation ?? null) : ((await cms.getVersion(key, ref.version))?.variation ?? null);
  }
  return {key, locale, displayName: displayName || key, variations, currentVariation, publicUrl: ref.publicUrl};
}

interface LoadedRule {
  flag: FxFlag;
  rule: FxRule;
  ruleset: FxRuleset;
  summary: RuleSummary;
}

async function loadRule({fx}: Deps, link: ExperimentLink): Promise<LoadedRule> {
  const envFx = fx.forEnvironment(link.environmentKey);
  const flag = await envFx.getFlag(link.flagKey);
  if (!flag) throw new ActionError('flag_missing', `Flag "${link.flagKey}" no longer exists in FX.`);
  if (flag.archived) throw new ActionError('flag_archived', `Flag "${link.flagKey}" is archived in FX.`);
  const ruleset = await envFx.getRuleset(link.flagKey);
  const rule = ruleset.rules[link.ruleKey];
  if (!rule || rule.archived) {
    throw new ActionError('rule_missing', `Rule "${link.ruleKey}" is gone from ${link.environmentKey}.`);
  }
  const summary = summarizeRule(flag, link.ruleKey, rule, ruleset, link.environmentKey, envFx.flagUrl(link.flagKey));
  return {flag, rule, ruleset, summary};
}

export function diffVariations(cmsVariations: CmsVariation[], ruleVariationKeys: string[]): VariationDiff {
  const invalid: VariationDiff['invalid'] = [];
  const valid: string[] = [];
  for (const {name} of cmsVariations) {
    const reason = variationNameProblem(name);
    if (reason) invalid.push({name, reason});
    else valid.push(name);
  }
  const cmsNames = new Set(cmsVariations.map((v) => v.name));
  return {
    missingInFx: valid.filter((n) => !ruleVariationKeys.includes(n)),
    missingInCms: ruleVariationKeys.filter(
      (k) => !(RESERVED_VARIATION_KEYS as readonly string[]).includes(k) && !cmsNames.has(k),
    ),
    invalid,
  };
}

/** Running CMS experiments in `fx`'s environment, other than those on `ownFlagKey`. */
async function runningExperiments(fx: FxClient, ownFlagKey?: string): Promise<RunningExperiment[]> {
  const flags = await fx.listFlags();
  return runningCmsExperiments(flags, fx.environmentKey, (key) => fx.flagUrl(key)).filter(
    (e) => e.flagKey !== ownFlagKey,
  );
}

/**
 * Refuses to start `flagKey` on `route` while another CMS experiment runs on an
 * overlapping route, unless the editor confirmed. Rules inside one flag don't clash:
 * FX gives a visitor one rule per flag.
 */
async function assertNoRunningClash(fx: FxClient, flagKey: string, route: string, confirmed?: boolean) {
  if (confirmed) return;
  const clashes = (await runningExperiments(fx, flagKey)).filter((e) => routesOverlap(e.route, route));
  if (clashes.length === 0) return;
  const names = clashes.map((e) => `${e.flagKey} / ${e.ruleKey} (${e.route || 'every route'})`).join(', ');
  throw new ActionError(
    'experiment_running',
    `Already running on this route: ${names}. Visitors would land in both, but the page shows one variation, ` +
      'so both results get muddied. Pause it first, or start anyway.',
  );
}

export async function getStatus(deps: Deps, ref: ContentRef): Promise<StatusResult> {
  const content = await resolveContent(deps, ref);
  const link = await getLink(content.key, content.locale);
  // Informational: a failed lookup shouldn't take the whole panel down.
  const envFx = deps.fx.forEnvironment(link?.environmentKey ?? deps.fx.environmentKey);
  const running = runningExperiments(envFx, link?.flagKey).catch((error: unknown) => {
    logger.warn('Running-experiment check failed', error);
    return null;
  });

  let rule: RuleSummary | null = null;
  let ruleError: string | null = null;
  if (link) {
    try {
      rule = (await loadRule(deps, link)).summary;
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      ruleError = error.message;
    }
  }

  const fxCfg = deps.fx;
  return {
    content: {
      key: content.key,
      locale: content.locale,
      displayName: content.displayName,
      currentVariation: content.currentVariation,
      suggestedFlagKey: defaultFlagKey(content.displayName, content.key.slice(0, 8)),
      suggestedRoute: defaultRoute(content.publicUrl),
    },
    cmsVariations: content.variations,
    link,
    rule,
    ruleError,
    diff: diffVariations(content.variations, rule ? rule.variations.map((v) => v.key) : []),
    runningExperiments: await running,
    settings: {
      projectId: fxCfg.projectId,
      environmentKey: fxCfg.environmentKey,
      audienceIds: fxCfg.audienceIds,
    },
  };
}

function flagDescription(contentKey: string, locale: string, route: string): string {
  return `Created by the Feature Experimentation CMS extension for content ${contentKey} (${locale}), route ${route}.`;
}

async function eventMetrics({fx}: Deps, eventIds: number[]) {
  if (eventIds.length === 0) return [];
  const events = await fx.listEvents();
  const byId = new Map(events.map((e) => [e.id, e]));
  return eventIds.map((id) => {
    const event = byId.get(id);
    if (!event) throw new ActionError('unknown_event', `Event ${id} isn't in project ${fx.projectId}.`);
    return metricFor(event);
  });
}

export async function createExperiment(deps: Deps, p: CreateExperimentParams): Promise<StatusResult> {
  const {fx} = deps;
  const flagProblem = flagKeyProblem(p.flagKey);
  if (flagProblem) throw new ActionError('invalid_flag_key', `Flag key: ${flagProblem}`);
  const routeIssue = routeProblem(p.route ?? '');
  if (routeIssue) throw new ActionError('invalid_route', `Route: ${routeIssue}`);
  const traffic = Number(p.trafficPercent);
  if (!(traffic >= 1 && traffic <= 100)) throw new ActionError('invalid_traffic', 'Traffic must be 1-100%.');
  if (!p.variations?.length) throw new ActionError('no_variations', 'Pick at least one CMS variation to test.');

  const content = await resolveContent(deps, p.content);
  if (await getLink(content.key, content.locale)) {
    throw new ActionError('already_linked', 'This page already has an experiment. Unlink it first.');
  }
  const cmsNames = new Set(content.variations.map((v) => v.name));
  for (const name of p.variations) {
    const problem = variationNameProblem(name);
    if (problem) throw new ActionError('invalid_variation', `${name}: ${problem}`);
    if (!cmsNames.has(name)) throw new ActionError('unknown_variation', `"${name}" isn't a variation of this page.`);
  }
  const route = p.route.trim();
  // Before anything is created, so a refusal leaves FX untouched.
  if (p.start) await assertNoRunningClash(fx, p.flagKey, route, p.confirmConflicts);
  const metrics = await eventMetrics(deps, p.eventIds ?? []);

  // Each step checks before it creates, so a retry after a partial failure (timeout,
  // 429, validation error halfway) picks up where the last attempt stopped.
  const existing = await fx.getFlag(p.flagKey);
  if (existing) {
    const ours = existing.description?.includes(content.key) && existing.variable_definitions?.[CMS_FLAG_VARIABLE];
    if (!ours || existing.archived) {
      throw new ActionError(
        'flag_exists',
        `Flag "${p.flagKey}" already exists in FX. Pick another key, or use "Link existing flag".`,
      );
    }
  } else {
    await fx.createFlag(p.flagKey, p.flagName || p.flagKey, flagDescription(content.key, content.locale, route), route);
  }

  const keys = experimentKeys(p.variations);
  const names = new Map(keys.map((k) => [k, k === CONTROL_VARIATION_KEY ? CONTROL_NAME : k]));
  const flagVariations = new Set((await fx.listVariations(p.flagKey)).map((v) => v.key));
  for (const key of keys) {
    if (!flagVariations.has(key)) await fx.createVariation(p.flagKey, key, names.get(key)!);
  }

  const ruleKey = `${p.flagKey}_experiment`;
  const ruleset = await fx.getRuleset(p.flagKey);
  if (!ruleset.rules[ruleKey]) {
    await fx.addAbRule(
      p.flagKey,
      ruleKey,
      `${p.flagName || p.flagKey} experiment`,
      keys.map((key) => ({key, name: names.get(key)!})),
      metrics,
      traffic,
    );
  }
  if (p.start) await fx.setRuleRunning(p.flagKey, ruleKey, true);

  await saveLink({
    contentKey: content.key,
    locale: content.locale,
    flagKey: p.flagKey,
    ruleKey,
    environmentKey: fx.environmentKey,
    route,
    displayName: p.displayName || content.displayName,
    createdAt: new Date().toISOString(),
  });
  return getStatus(deps, p.content);
}

async function requireLinked(deps: Deps, ref: ContentRef) {
  const status = await getStatus(deps, ref);
  if (!status.link) throw new ActionError('not_linked', 'This page has no experiment yet.');
  if (!status.rule) throw new ActionError('rule_unavailable', status.ruleError ?? 'The linked rule is unavailable.');
  return {status, link: status.link, rule: status.rule, fx: deps.fx.forEnvironment(status.link.environmentKey)};
}

export async function syncVariations(
  deps: Deps,
  {content, confirmRunning}: ActionParams['syncVariations'],
): Promise<StatusResult> {
  const {status, link, rule, fx} = await requireLinked(deps, content);
  const missing = status.diff.missingInFx;
  if (missing.length === 0) return status;
  if (rule.running && !confirmRunning) {
    throw new ActionError(
      'confirm_running',
      'The experiment is running. Adding variations re-splits traffic, so some visitors will switch variation.',
    );
  }

  const flagVariations = new Set((await fx.listVariations(link.flagKey)).map((v) => v.key));
  for (const key of missing) {
    if (!flagVariations.has(key)) await fx.createVariation(link.flagKey, key, key);
  }
  // Keep the rule's existing arms (in order) and append the new ones; split evenly.
  const next = [...rule.variations.map((v) => ({key: v.key, name: v.name})), ...missing.map((key) => ({key, name: key}))];
  await fx.setRuleVariations(link.flagKey, link.ruleKey, next);
  return getStatus(deps, content);
}

export async function setMetrics(deps: Deps, {content, eventIds}: ActionParams['setMetrics']): Promise<StatusResult> {
  const {link, fx} = await requireLinked(deps, content);
  await fx.setRuleMetrics(link.flagKey, link.ruleKey, await eventMetrics(deps, eventIds ?? []));
  return getStatus(deps, content);
}

export async function setRunning(
  deps: Deps,
  {content, running, confirmConflicts}: ActionParams['setRunning'],
): Promise<StatusResult> {
  const {link, rule, fx} = await requireLinked(deps, content);
  // rule.route is the flag's cms_route; '' means the flag applies to every route.
  if (running) await assertNoRunningClash(fx, link.flagKey, rule.route, confirmConflicts);
  await fx.setRuleRunning(link.flagKey, link.ruleKey, Boolean(running));
  return getStatus(deps, content);
}

export async function setRoute(deps: Deps, {content, route}: ActionParams['setRoute']): Promise<StatusResult> {
  const problem = routeProblem(route ?? '');
  if (problem) throw new ActionError('invalid_route', `Route: ${problem}`);
  const {link, fx} = await requireLinked(deps, content);
  const flag = await fx.getFlag(link.flagKey);
  if (!flag?.variable_definitions?.cms_route) {
    throw new ActionError(
      'no_route_variable',
      `Flag "${link.flagKey}" has no cms_route variable, so it applies to every route. Add the variable in FX to scope it.`,
    );
  }
  await fx.setRouteDefault(link.flagKey, route.trim());
  await saveLink({...link, route: route.trim()});
  return getStatus(deps, content);
}

export async function linkExisting(
  deps: Deps,
  {content: ref, displayName, flagKey, ruleKey}: ActionParams['linkExisting'],
): Promise<StatusResult> {
  const {fx} = deps;
  const content = await resolveContent(deps, ref);
  if (await getLink(content.key, content.locale)) {
    throw new ActionError('already_linked', 'This page already has an experiment. Unlink it first.');
  }
  const flag = await fx.getFlag(flagKey);
  if (!flag || flag.archived) throw new ActionError('flag_missing', `No active flag "${flagKey}" in FX.`);
  if (!flag.variable_definitions?.[CMS_FLAG_VARIABLE]) {
    throw new ActionError(
      'not_cms_flag',
      `Flag "${flagKey}" has no ${CMS_FLAG_VARIABLE} variable, so the site won't serve CMS variations from it.`,
    );
  }
  const ruleset = await fx.getRuleset(flagKey);
  const abRules = (ruleset.rule_priorities ?? Object.keys(ruleset.rules)).filter(
    (k) => ruleset.rules[k]?.type === 'a/b' && !ruleset.rules[k]?.archived,
  );
  const chosen = ruleKey || abRules[0];
  if (!chosen || !ruleset.rules[chosen]) {
    throw new ActionError('no_ab_rule', `Flag "${flagKey}" has no A/B rule in ${fx.environmentKey}.`);
  }
  await saveLink({
    contentKey: content.key,
    locale: content.locale,
    flagKey,
    ruleKey: chosen,
    environmentKey: fx.environmentKey,
    route: flag.variable_definitions?.cms_route?.default_value ?? '',
    displayName: displayName || content.displayName,
    createdAt: new Date().toISOString(),
  });
  return getStatus(deps, ref);
}

export async function unlink(deps: Deps, {content}: ActionParams['unlink']): Promise<StatusResult> {
  if (!content?.key) throw new ActionError('missing_content', 'No content item is open.');
  const key = normalizeKey(content.key);
  const locale = content.locale || (await deps.cms.primaryLocale(key));
  await removeLink(key, locale);
  return getStatus(deps, content);
}

export async function listExperiments(deps: Deps): Promise<ExperimentRow[]> {
  const links = await listLinks();
  const rows: ExperimentRow[] = [];
  // A few at a time: each link is two FX calls, and FX rate-limits bursts.
  for (let i = 0; i < links.length; i += 4) {
    rows.push(
      ...(await Promise.all(
        links.slice(i, i + 4).map(async (link) => {
          try {
            return {link, rule: (await loadRule(deps, link)).summary, error: null};
          } catch (error) {
            const message = error instanceof ActionError || error instanceof ApiError ? error.message : 'FX lookup failed.';
            return {link, rule: null, error: message};
          }
        }),
      )),
    );
  }
  return rows;
}
