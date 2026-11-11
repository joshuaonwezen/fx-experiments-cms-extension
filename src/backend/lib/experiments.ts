import {logger} from '@zaiusinc/app-sdk';

import {
  addArms,
  defaultFlagKey,
  defaultRoute,
  experimentKeys,
  flagKeyProblem,
  normalizeKey,
  removeArms,
  routeCovers,
  routeProblem,
  routesOverlap,
  splitTraffic,
  uncoveredPaths,
  variationNameProblem,
  visitorPaths,
  withPaths,
} from '../../shared/experiment';
import {reservedVariationKeys, type SiteProfile} from '../../shared/profile';
import {blockers, readiness} from '../../shared/readiness';
import type {
  ActionParams,
  AudienceOption,
  CmsFlagOption,
  CmsVariation,
  Conclusion,
  ContentRef,
  CreateExperimentParams,
  DeleteCandidate,
  ExperimentLink,
  ExperimentRow,
  RuleSummary,
  RunningExperiment,
  StatusResult,
  VariationDiff,
} from '../../shared/types';
import {CmsClient, CmsVersion, summarizeVersions} from './cms';
import {datafileAudiences, fetchDatafile, isRuleLive, liveCmsRules, toRunningExperiments, type Datafile} from './datafile';
import {ActionError} from './errors';
import {armsOf, FxClient, FxFlag, FxRule, FxRuleset, metricFor, runningCmsExperiments, summarizeRule} from './fx';
import {ApiError} from './http';
import {getLink, listLinks, removeLink, saveLink} from './links';
import {storedKeys} from './validate';

export {ActionError};

const CONTROL_NAME = 'Control (original page)';

export interface Deps {
  fx: FxClient;
  cms: CmsClient;
  profile: SiteProfile;
  /** An admin allowed "End experiment" to delete CMS variations. */
  allowDelete: boolean;
}

interface ResolvedContent {
  key: string;
  locale: string;
  /** The language the item was created in; its URLs get both the bare and the prefixed form. */
  primaryLocale: string;
  displayName: string;
  variations: CmsVariation[];
  basePublished: boolean;
  currentVariation: string | null;
  publicUrl?: string;
  /** Newest first, as the CMS lists them. */
  versions: CmsVersion[];
}

/**
 * The item's versions in `locale`. The editor reports its UI locale even for items
 * without language versions (media, folders), and the CMS answers those with a 404, so
 * look the item up once to say what's wrong instead of passing the raw error on.
 */
export async function listVersionsOrExplain(cms: CmsClient, key: string, locale: string) {
  try {
    return await cms.listVersions(key, locale);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const item = await cms.getItem(key);
    if (!item) throw new ActionError('content_missing', 'This item no longer exists in the CMS.');
    const locales = (item.locales ?? []).filter(Boolean);
    if (locales.length === 0) {
      const what = item.contentType ? ` (${item.contentType})` : '';
      throw new ActionError(
        'unsupported_content',
        `Experiments run on pages. This item${what} has no language versions, so it can't have variations.`,
      );
    }
    throw new ActionError('locale_missing', `This item has no "${locale}" version. It exists in: ${locales.join(', ')}.`);
  }
}

async function resolveContent({cms}: Deps, ref: ContentRef): Promise<ResolvedContent> {
  // Already normalized when the request came through the router; direct callers (tests) may pass dashes.
  const key = normalizeKey(ref.key);
  // The editor normally reports the locale, so both reads can run at once.
  const [primaryLocale, versionsInRefLocale] = await Promise.all([
    cms.primaryLocale(key),
    ref.locale ? listVersionsOrExplain(cms, key, ref.locale) : null,
  ]);
  const locale = ref.locale || primaryLocale;
  const versions = versionsInRefLocale ?? (await listVersionsOrExplain(cms, key, locale));
  const {variations, displayName, basePublished} = summarizeVersions(versions);

  let currentVariation: string | null = null;
  if (ref.version) {
    const listed = versions.find((v) => String(v.version) === String(ref.version));
    currentVariation = listed ? (listed.variation ?? null) : ((await cms.getVersion(key, ref.version))?.variation ?? null);
  }
  return {
    key,
    locale,
    primaryLocale,
    displayName: displayName || key,
    variations,
    basePublished,
    currentVariation,
    publicUrl: ref.publicUrl,
    versions,
  };
}

interface LoadedRule {
  flag: FxFlag;
  rule: FxRule;
  ruleset: FxRuleset;
  summary: RuleSummary;
}

async function loadRule({fx, profile}: Deps, link: ExperimentLink): Promise<LoadedRule> {
  const {flagKey, ruleKey, environmentKey} = storedKeys(link);
  const envFx = fx.forEnvironment(environmentKey);
  const flag = await envFx.getFlag(flagKey);
  if (!flag) throw new ActionError('flag_missing', `Flag "${flagKey}" no longer exists in FX.`);
  if (flag.archived) throw new ActionError('flag_archived', `Flag "${flagKey}" is archived in FX.`);
  const [ruleset, variations] = await Promise.all([envFx.getRuleset(flagKey), envFx.listVariations(flagKey)]);
  const rule = ruleset.rules[ruleKey];
  if (!rule || rule.archived) {
    throw new ActionError('rule_missing', `Rule "${ruleKey}" is gone from ${environmentKey}.`);
  }
  const summary = summarizeRule(flag, ruleKey, rule, ruleset, environmentKey, envFx.flagUrl(flagKey), profile, variations);
  return {flag, rule, ruleset, summary};
}

export function diffVariations(cmsVariations: CmsVariation[], ruleVariationKeys: string[], profile: SiteProfile): VariationDiff {
  const invalid: VariationDiff['invalid'] = [];
  const valid: string[] = [];
  for (const {name} of cmsVariations) {
    const reason = variationNameProblem(name, profile);
    if (reason) invalid.push({name, reason});
    else valid.push(name);
  }
  const status = new Map(cmsVariations.map((v) => [v.name, v.status]));
  const challengers = ruleVariationKeys.filter((k) => !reservedVariationKeys(profile).includes(k));
  return {
    missingInFx: valid.filter((n) => !ruleVariationKeys.includes(n)),
    missingInCms: challengers.filter((k) => !status.has(k)),
    unpublished: challengers.filter((k) => status.has(k) && status.get(k) !== 'published'),
    invalid,
  };
}

interface LiveState {
  /** Live CMS rules on every flag, own flag included. */
  rules: RunningExperiment[];
  datafile: Datafile | null;
}

// The Flags API fallback lists every flag; cache it briefly per project and environment.
const flagListCache = new Map<string, {at: number; rules: RunningExperiment[]}>();
const FLAG_LIST_CACHE_MS = 30_000;

/**
 * What the site serves right now. With an SDK key that is the datafile itself, which has
 * per-variation variable values; without one (installs saved before the SDK key setting),
 * the Flags API list, which only sees defaults.
 */
async function liveState({fx, profile}: Deps, envFx: FxClient): Promise<LiveState> {
  if (fx.sdkKey && envFx.environmentKey === fx.environmentKey) {
    const datafile = await fetchDatafile(fx.sdkKey);
    const rules = toRunningExperiments(liveCmsRules(datafile, profile), (k) => k, (k) => envFx.flagUrl(k));
    return {rules, datafile};
  }
  const cacheKey = `${envFx.projectId}:${envFx.environmentKey}`;
  const hit = flagListCache.get(cacheKey);
  if (hit && Date.now() - hit.at < FLAG_LIST_CACHE_MS) return {rules: hit.rules, datafile: null};
  const rules = runningCmsExperiments(await envFx.listFlags(), envFx.environmentKey, profile, (k) => envFx.flagUrl(k));
  flagListCache.set(cacheKey, {at: Date.now(), rules});
  return {rules, datafile: null};
}

/**
 * Variations the end-of-test cleanup may delete: this test's arms that still exist in
 * the CMS, minus control, minus a winner that is still being served, minus anything
 * another live rule serves on this page (the homepage's persona variations, say).
 * Empty when FX couldn't be checked, because then nothing can be shown to be unused.
 */
export function deleteCandidates(
  content: Pick<ResolvedContent, 'versions'>,
  link: ExperimentLink,
  armKeys: string[],
  live: RunningExperiment[] | null,
  paths: string[],
  profile: SiteProfile,
): DeleteCandidate[] {
  const ended = link.conclusion;
  if (!ended || live === null) return [];
  const keep = new Set(reservedVariationKeys(profile));
  if (ended.winner && (ended.shipVia === 'fx' || (ended.shipVia === 'cms' && ended.promotion !== 'published'))) {
    keep.add(ended.winner);
  }
  for (const rule of live) {
    if (rule.flagKey === link.flagKey && rule.ruleKey === link.ruleKey) continue;
    if (!paths.some((p) => routeCovers(rule.route, p))) continue;
    // The Flags API fallback can't say which variations a rule serves: keep them all.
    if (rule.variations.length === 0) return [];
    rule.variations.forEach((v) => keep.add(v));
  }
  return armKeys
    .filter((key) => !keep.has(key))
    .map((name) => ({
      name,
      versions: content.versions
        .filter((v) => v.variation === name)
        .map((v) => ({version: String(v.version), status: v.status})),
    }))
    .filter((c) => c.versions.length > 0);
}

export async function getStatus(deps: Deps, ref: ContentRef): Promise<StatusResult> {
  const {profile} = deps;
  const content = await resolveContent(deps, ref);
  const link = await getLink(content.key, content.locale);
  const envFx = deps.fx.forEnvironment(link?.environmentKey ?? deps.fx.environmentKey);
  // Informational: a failed lookup shouldn't take the whole panel down.
  const livePromise = liveState(deps, envFx).catch((error: unknown) => {
    logger.warn('Live-rule check failed', error);
    return null;
  });

  let rule: RuleSummary | null = null;
  let ruleError: string | null = null;
  if (link && !link.conclusion?.archived) {
    try {
      rule = (await loadRule(deps, link)).summary;
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      ruleError = error.message;
    }
  }

  const live = await livePromise;
  const paths = visitorPaths(content.publicUrl, content.locale, content.primaryLocale);
  const armKeys = rule ? rule.variations.map((v) => v.key) : [];
  return {
    content: {
      key: content.key,
      locale: content.locale,
      displayName: content.displayName,
      currentVariation: content.currentVariation,
      basePublished: content.basePublished,
      suggestedFlagKey: defaultFlagKey(content.displayName, content.key.slice(0, 8)),
      suggestedRoute: defaultRoute(content.publicUrl, content.locale, content.primaryLocale),
      visitorPaths: paths,
    },
    cmsVariations: content.variations,
    link,
    rule,
    ruleError,
    diff: diffVariations(content.variations, armKeys, profile),
    // Rules inside one flag don't compete: FX gives a visitor one rule per flag.
    runningExperiments: live ? live.rules.filter((r) => r.flagKey !== link?.flagKey) : null,
    liveOnSite: link && live?.datafile ? isRuleLive(live.datafile, link.flagKey, link.ruleKey) : null,
    deleteCandidates: link ? deleteCandidates(content, link, armKeys, live?.rules ?? null, paths, profile) : [],
    settings: {
      projectId: deps.fx.projectId,
      environmentKey: deps.fx.environmentKey,
      allowDelete: deps.allowDelete,
      profile,
    },
  };
}

/** Refuses to start while a blocking readiness item fails (unpublished page or variation). */
function assertReady(deps: Deps, content: ResolvedContent, arms: string[], route: string, metricCount: number) {
  const items = readiness({
    basePublished: content.basePublished,
    arms: arms.filter((a) => !reservedVariationKeys(deps.profile).includes(a)),
    cmsVariations: content.variations,
    metricCount,
    route,
    visitorPaths: [],
    running: [],
    profile: deps.profile,
  });
  const problems = blockers(items);
  if (problems.length > 0) throw new ActionError('not_ready', `Not ready to start. ${problems.join(' ')}`);
}

/**
 * Refuses to start `flagKey` on `route` while another CMS experiment or delivery serves
 * an overlapping route, unless the editor confirmed.
 */
async function assertNoRunningClash(deps: Deps, fx: FxClient, flagKey: string, route: string, confirmed?: boolean) {
  if (confirmed) return;
  const {rules} = await liveState(deps, fx);
  const clashes = rules.filter((e) => e.flagKey !== flagKey && routesOverlap(e.route, route));
  if (clashes.length === 0) return;
  const names = clashes
    .map((e) => `${e.flagKey} / ${e.ruleKey} (${e.kind === 'delivery' ? 'personalization' : 'experiment'}, ${e.route || 'every route'})`)
    .join(', ');
  throw new ActionError(
    'experiment_running',
    `Already changing this route: ${names}. Visitors would get both, but the page shows one variation, ` +
      'so the results get muddied. Pause it first, or start anyway.',
  );
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

function writeDenied(error: unknown): never {
  if (error instanceof ApiError && error.status === 403) {
    throw new ActionError(
      'cms_write_denied',
      'The CMS API key in the app settings can read content but not change it. Use a key with content write access.',
    );
  }
  throw error;
}

export async function createExperiment(deps: Deps, p: CreateExperimentParams): Promise<StatusResult> {
  const {fx, profile} = deps;
  const flagProblem = flagKeyProblem(p.flagKey, profile);
  if (flagProblem) throw new ActionError('invalid_flag_key', `Flag key: ${flagProblem}`);
  const route = p.route.trim();
  const routeIssue = routeProblem(route);
  if (routeIssue) throw new ActionError('invalid_route', `Route: ${routeIssue}`);
  if (!p.variations.length) throw new ActionError('no_variations', 'Pick at least one CMS variation to test.');

  const content = await resolveContent(deps, p.content);
  if (await getLink(content.key, content.locale)) {
    throw new ActionError('already_linked', 'This page already has an experiment. Unlink it first.');
  }
  const cmsNames = new Set(content.variations.map((v) => v.name));
  for (const name of p.variations) {
    const problem = variationNameProblem(name, profile);
    if (problem) throw new ActionError('invalid_variation', `${name}: ${problem}`);
    if (!cmsNames.has(name)) throw new ActionError('unknown_variation', `"${name}" isn't a variation of this page.`);
  }
  // Before anything is created, so a refusal leaves FX untouched.
  if (p.start) {
    assertReady(deps, content, p.variations, route, p.eventIds.length);
    await assertNoRunningClash(deps, fx, p.flagKey, route, p.confirmConflicts);
  }
  const metrics = await eventMetrics(deps, p.eventIds);

  // Each step checks before it creates, so a retry after a partial failure (timeout,
  // 429, validation error halfway) picks up where the last attempt stopped.
  const existing = await fx.getFlag(p.flagKey);
  if (existing) {
    const ours = existing.description?.includes(content.key) && existing.variable_definitions?.[profile.markerVariable];
    if (!ours || existing.archived) {
      throw new ActionError(
        'flag_exists',
        `Flag "${p.flagKey}" already exists in FX. Pick another key, or use "Link an existing flag".`,
      );
    }
    // Ours, e.g. created for this page in another language: widen its route to this one.
    const current = existing.variable_definitions?.[profile.routeVariable]?.default_value ?? '';
    const entries = route.split(',').map((e) => e.trim());
    if (current.trim() && uncoveredPaths(current, entries).length > 0) {
      await fx.setRouteDefault(p.flagKey, profile.routeVariable, withPaths(current, entries));
    }
  } else {
    await fx.createFlag(
      p.flagKey,
      p.flagName || p.flagKey,
      flagDescription(content.key, content.locale, route),
      route,
      profile,
    );
  }

  const keys = experimentKeys(p.variations, profile.controlKey);
  const nameOf = (k: string) => (k === profile.controlKey ? CONTROL_NAME : k);
  const flagVariations = new Set((await fx.listVariations(p.flagKey)).map((v) => v.key));
  for (const key of keys) {
    if (!flagVariations.has(key)) await fx.createVariation(p.flagKey, key, nameOf(key));
  }

  const ruleKey = `${p.flagKey.slice(0, 53)}_experiment`;
  const arms = splitTraffic(keys).map((a) => ({...a, name: nameOf(a.key)}));
  const ruleset = await fx.getRuleset(p.flagKey);
  const previous = ruleset.rules[ruleKey];
  if (!previous) {
    await fx.addAbRule(p.flagKey, ruleKey, `${p.flagName || p.flagKey} experiment`, arms, metrics, p.trafficPercent, p.audienceIds);
  } else {
    // A retry with a different pick: make the rule match this request, not the last one.
    const current = Object.keys(previous.variations ?? {}).sort().join(',');
    if (current !== [...keys].sort().join(',')) await fx.setRuleArms(p.flagKey, ruleKey, arms);
    await fx.setRuleMetrics(p.flagKey, ruleKey, metrics);
    await fx.setRuleTraffic(p.flagKey, ruleKey, p.trafficPercent);
    await fx.setRuleAudiences(p.flagKey, ruleKey, p.audienceIds);
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

interface Linked {
  content: ResolvedContent;
  link: ExperimentLink;
  loaded: LoadedRule;
  fx: FxClient;
}

/** The open page's experiment and its rule; refuses edits once it has ended unless `ended` is allowed. */
async function requireLinked(deps: Deps, ref: ContentRef, {ended = false} = {}): Promise<Linked> {
  const content = await resolveContent(deps, ref);
  const link = await getLink(content.key, content.locale);
  if (!link) throw new ActionError('not_linked', 'This page has no experiment yet.');
  if (link.conclusion && !ended) {
    throw new ActionError('ended', 'This experiment has ended. Unlink it to start a new one on this page.');
  }
  if (link.conclusion?.archived) throw new ActionError('archived', 'This experiment\'s flag is archived.');
  const loaded = await loadRule(deps, link);
  return {content, link, loaded, fx: deps.fx.forEnvironment(link.environmentKey)};
}

export async function syncVariations(
  deps: Deps,
  {content: ref, confirmRunning}: ActionParams['syncVariations'],
): Promise<StatusResult> {
  const {content, link, loaded, fx} = await requireLinked(deps, ref);
  const missing = diffVariations(content.variations, Object.keys(loaded.rule.variations ?? {}), deps.profile).missingInFx;
  if (missing.length === 0) return getStatus(deps, ref);
  if (loaded.summary.running && !confirmRunning) {
    throw new ActionError(
      'confirm_running',
      'The experiment is running. Adding variations re-splits traffic, so some visitors will switch variation.',
    );
  }

  const flagVariations = new Set((await fx.listVariations(link.flagKey)).map((v) => v.key));
  for (const key of missing) {
    if (!flagVariations.has(key)) await fx.createVariation(link.flagKey, key, key);
  }
  const current = armsOf(loaded.rule);
  const names = new Map(current.map((a) => [a.key, a.name]));
  await fx.setRuleArms(
    link.flagKey,
    link.ruleKey,
    addArms(current, missing).map((a) => ({...a, name: names.get(a.key) ?? a.key})),
  );
  return getStatus(deps, ref);
}

export async function removeVariations(
  deps: Deps,
  {content: ref, variations, confirmRunning}: ActionParams['removeVariations'],
): Promise<StatusResult> {
  const {link, loaded, fx} = await requireLinked(deps, ref);
  const current = armsOf(loaded.rule);
  for (const key of variations) {
    if (key === deps.profile.controlKey) throw new ActionError('invalid_variation', 'The original page stays in the test.');
    if (!current.some((a) => a.key === key)) throw new ActionError('unknown_variation', `"${key}" isn't in the test.`);
  }
  const next = removeArms(current, variations);
  if (!next.some((a) => a.key !== deps.profile.controlKey && a.key !== 'off')) {
    throw new ActionError('last_variation', 'Keep at least one variation to compare against the original page.');
  }
  if (loaded.summary.running && !confirmRunning) {
    throw new ActionError(
      'confirm_running',
      'The experiment is running. Removing a variation moves its visitors to the other groups.',
    );
  }
  const names = new Map(current.map((a) => [a.key, a.name]));
  await fx.setRuleArms(link.flagKey, link.ruleKey, next.map((a) => ({...a, name: names.get(a.key) ?? a.key})));
  return getStatus(deps, ref);
}

export async function setMetrics(deps: Deps, {content, eventIds}: ActionParams['setMetrics']): Promise<StatusResult> {
  const {link, fx} = await requireLinked(deps, content);
  await fx.setRuleMetrics(link.flagKey, link.ruleKey, await eventMetrics(deps, eventIds));
  return getStatus(deps, content);
}

export async function setTraffic(deps: Deps, {content, trafficPercent}: ActionParams['setTraffic']): Promise<StatusResult> {
  const {link, fx} = await requireLinked(deps, content);
  await fx.setRuleTraffic(link.flagKey, link.ruleKey, trafficPercent);
  return getStatus(deps, content);
}

export async function setAudiences(deps: Deps, {content, audienceIds}: ActionParams['setAudiences']): Promise<StatusResult> {
  const {link, fx} = await requireLinked(deps, content);
  await fx.setRuleAudiences(link.flagKey, link.ruleKey, audienceIds);
  return getStatus(deps, content);
}

export async function setRunning(
  deps: Deps,
  {content: ref, running, confirmConflicts}: ActionParams['setRunning'],
): Promise<StatusResult> {
  const {content, link, loaded, fx} = await requireLinked(deps, ref);
  const {summary} = loaded;
  if (running) {
    assertReady(deps, content, summary.variations.map((v) => v.key), summary.route, summary.metrics.length);
    // summary.route is the flag's effective route; '' means the flag applies to every route.
    await assertNoRunningClash(deps, fx, link.flagKey, summary.route, confirmConflicts);
  }
  await fx.setRuleRunning(link.flagKey, link.ruleKey, running);
  return getStatus(deps, ref);
}

export async function setRoute(deps: Deps, {content, route}: ActionParams['setRoute']): Promise<StatusResult> {
  const trimmed = route.trim();
  const problem = routeProblem(trimmed);
  if (problem) throw new ActionError('invalid_route', `Route: ${problem}`);
  const {link, loaded, fx} = await requireLinked(deps, content);
  const {routeVariable} = deps.profile;
  if (!loaded.flag.variable_definitions?.[routeVariable]) {
    throw new ActionError(
      'no_route_variable',
      `Flag "${link.flagKey}" has no ${routeVariable} variable, so it applies to every route. Add the variable in FX to scope it.`,
    );
  }
  if (loaded.summary.routePerVariation) {
    throw new ActionError(
      'route_per_variation',
      `Flag "${link.flagKey}" sets ${routeVariable} per variation, so the route has to be changed in FX.`,
    );
  }
  await fx.setRouteDefault(link.flagKey, routeVariable, trimmed);
  await saveLink({...link, route: trimmed});
  return getStatus(deps, content);
}

export async function linkExisting(
  deps: Deps,
  {content: ref, displayName, flagKey, ruleKey}: ActionParams['linkExisting'],
): Promise<StatusResult> {
  const {fx, profile} = deps;
  const content = await resolveContent(deps, ref);
  if (await getLink(content.key, content.locale)) {
    throw new ActionError('already_linked', 'This page already has an experiment. Unlink it first.');
  }
  const flag = await fx.getFlag(flagKey);
  if (!flag || flag.archived) throw new ActionError('flag_missing', `No active flag "${flagKey}" in FX.`);
  const marker = flag.variable_definitions?.[profile.markerVariable];
  if (!marker) {
    throw new ActionError(
      'not_cms_flag',
      `Flag "${flagKey}" has no ${profile.markerVariable} variable, so the site won't serve CMS variations from it.`,
    );
  }
  if (marker.type !== 'boolean') {
    throw new ActionError('not_cms_flag', `${profile.markerVariable} on "${flagKey}" is a ${marker.type}; the site needs a boolean.`);
  }
  const routeDef = flag.variable_definitions?.[profile.routeVariable];
  if (routeDef && routeDef.type !== 'string') {
    throw new ActionError('not_cms_flag', `${profile.routeVariable} on "${flagKey}" is a ${routeDef.type}; the site needs a string.`);
  }
  const ruleset = await fx.getRuleset(flagKey);
  const abRules = (ruleset.rule_priorities ?? Object.keys(ruleset.rules)).filter(
    (k) => ruleset.rules[k]?.type === 'a/b' && !ruleset.rules[k]?.archived,
  );
  const chosen = ruleKey || abRules[0];
  if (!chosen || !ruleset.rules[chosen] || ruleset.rules[chosen].type !== 'a/b') {
    throw new ActionError('no_ab_rule', `Flag "${flagKey}" has no A/B rule${ruleKey ? ` "${ruleKey}"` : ''} in ${fx.environmentKey}.`);
  }
  // The route on the link is informational; the flag's own variable stays the authority.
  // If it doesn't cover this page, the status shows that with a one-click fix.
  await saveLink({
    contentKey: content.key,
    locale: content.locale,
    flagKey,
    ruleKey: chosen,
    environmentKey: fx.environmentKey,
    route: routeDef?.default_value ?? '',
    displayName: displayName || content.displayName,
    createdAt: new Date().toISOString(),
  });
  return getStatus(deps, ref);
}

export async function unlink(deps: Deps, {content, confirmRunning}: ActionParams['unlink']): Promise<StatusResult> {
  const key = normalizeKey(content.key);
  const locale = content.locale || (await deps.cms.primaryLocale(key));
  const link = await getLink(key, locale);
  if (link && !link.conclusion && !confirmRunning) {
    const running = await loadRule(deps, link).then(
      (l) => l.summary.running,
      () => false,
    );
    if (running) {
      throw new ActionError(
        'confirm_running',
        'The experiment is still running. Unlinking hides it here but visitors keep getting it. Pause it first, or unlink anyway.',
      );
    }
  }
  await removeLink(key, locale);
  return getStatus(deps, content);
}

/**
 * Ends the experiment: pauses the A/B rule and ships the winner. Each step checks what
 * is already done, so calling it again after a partial failure (or once an approval
 * workflow has published the promoted version) picks up where it stopped.
 */
export async function endExperiment(
  deps: Deps,
  {content: ref, winner, shipVia}: ActionParams['endExperiment'],
): Promise<StatusResult> {
  const {profile} = deps;
  const {content, link, loaded, fx} = await requireLinked(deps, ref, {ended: true});
  const arms = Object.keys(loaded.rule.variations ?? {});
  if (winner !== null && !arms.includes(winner)) throw new ActionError('unknown_variation', `"${winner}" isn't in the test.`);
  const originalWon = winner === null || winner === profile.controlKey;
  const via = originalWon ? null : shipVia;
  if (!originalWon && !via) throw new ActionError('ship_required', 'Choose how to ship the winner.');

  const previous = link.conclusion;
  if (previous && (previous.winner !== winner || previous.shipVia !== via)) {
    throw new ActionError('already_ended', `This experiment already ended with "${previous.winner ?? 'no winner'}".`);
  }
  const conclusion: Conclusion = previous ?? {endedAt: new Date().toISOString(), winner, shipVia: via};

  // 1. Stop the test. Visitors get the original page until the winner ships.
  if (loaded.rule.enabled) await fx.setRuleRunning(link.flagKey, link.ruleKey, false);

  // 2. Ship the winner.
  if (via === 'fx' && winner) {
    const deliveryKey = `${link.flagKey.slice(0, 57)}_winner`;
    const ruleset = await fx.getRuleset(link.flagKey);
    if (!ruleset.rules[deliveryKey]) {
      const arm = loaded.rule.variations[winner];
      await fx.addDeliveryRule(
        link.flagKey,
        deliveryKey,
        `Winner: ${winner}`,
        {key: winner, name: arm?.name ?? winner},
        loaded.summary.audienceIds,
      );
    }
    if (!ruleset.rules[deliveryKey]?.enabled) await fx.setRuleRunning(link.flagKey, deliveryKey, true);
    conclusion.deliveryRuleKey = deliveryKey;
  }
  if (via === 'cms' && winner && conclusion.promotion !== 'published') {
    try {
      if (conclusion.promotedVersion) {
        conclusion.promotion = await deps.cms.publishVersion(content.key, conclusion.promotedVersion);
      } else {
        const promoted = await promoteVariation(deps.cms, content, winner);
        conclusion.promotedVersion = promoted.version;
        conclusion.promotion = promoted.outcome;
      }
    } catch (error) {
      // Keep what's done so a retry resumes; a 403 becomes a readable message.
      await saveLink({...link, conclusion});
      writeDenied(error);
    }
  }

  await saveLink({...link, conclusion});
  logger.info('Experiment ended', {content: content.key, locale: content.locale, flag: link.flagKey, winner, via});
  return getStatus(deps, ref);
}

/**
 * Makes `winner` the page: a new base version with the base's properties and the winning
 * variation's composition (and any properties it sets), published. A variation version
 * of an experience carries only its composition, and a new draft starts with no
 * properties, so every base property is patched back on explicitly.
 */
export async function promoteVariation(
  cms: CmsClient,
  content: Pick<ResolvedContent, 'key' | 'locale' | 'versions'>,
  winner: string,
): Promise<{version: string; outcome: 'published' | 'awaiting_approval'}> {
  const base = content.versions.find((v) => !v.variation && v.status === 'published');
  const won = content.versions.find((v) => v.variation === winner && v.status === 'published');
  if (!base) throw new ActionError('not_ready', 'The original page has no published version to build on.');
  if (!won) throw new ActionError('not_ready', `"${winner}" has no published version to copy.`);

  const version = await cms.createBaseDraft(content.key, content.locale, {
    displayName: base.displayName,
    routeSegment: base.routeSegment,
  });
  const body: Record<string, unknown> = {properties: {...(base.properties ?? {}), ...(won.properties ?? {})}};
  if (won.composition) {
    // Keep the page's own name on the composition rather than the variation's.
    const name = (base.composition as {displayName?: string} | undefined)?.displayName;
    body.composition = name ? {...won.composition, displayName: name} : won.composition;
  }
  await cms.patchVersion(content.key, version, body);
  return {version, outcome: await cms.publishVersion(content.key, version)};
}

/**
 * Deletes the variations the cleanup lists, after the editor confirmed that exact list.
 * Non-published versions go first; the CMS refuses to delete a published version, and
 * each refusal is reported rather than failing the rest.
 */
export async function deleteVariations(deps: Deps, {content: ref, confirm}: ActionParams['deleteVariations']): Promise<StatusResult> {
  if (!deps.allowDelete) {
    throw new ActionError(
      'delete_disabled',
      'Deleting variations is turned off. An admin can turn it on in the app settings (CMS API client section).',
    );
  }
  const {content, link, loaded, fx} = await requireLinked(deps, ref, {ended: true});
  if (!link.conclusion) throw new ActionError('not_ended', 'End the experiment before deleting its variations.');
  const live = await liveState(deps, fx).catch(() => null);
  const paths = visitorPaths(content.publicUrl, content.locale, content.primaryLocale);
  const candidates = deleteCandidates(content, link, Object.keys(loaded.rule.variations ?? {}), live?.rules ?? null, paths, deps.profile);
  const listed = candidates.map((c) => c.name).sort().join(',');
  if (listed !== [...confirm].sort().join(',')) {
    throw new ActionError('stale_confirmation', 'The list of variations to delete changed. Review it and confirm again.');
  }

  const deleted: string[] = [];
  const notDeleted: NonNullable<Conclusion['notDeleted']> = [];
  for (const candidate of candidates) {
    const ordered = [...candidate.versions].sort((a, b) => Number(a.status === 'published') - Number(b.status === 'published'));
    let all = true;
    for (const {version} of ordered) {
      try {
        await deps.cms.deleteVersion(content.key, version);
        logger.info('Deleted CMS variation version', {content: content.key, locale: content.locale, variation: candidate.name, version});
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) writeDenied(error);
        if (!(error instanceof ApiError)) throw error;
        all = false;
        notDeleted.push({name: candidate.name, version, reason: error.message.replace(/^Delete version: /, '').slice(0, 200)});
      }
    }
    if (all) deleted.push(candidate.name);
  }

  const conclusion: Conclusion = {
    ...link.conclusion,
    deleted: [...new Set([...(link.conclusion.deleted ?? []), ...deleted])],
    notDeleted,
  };
  await saveLink({...link, conclusion});
  return getStatus(deps, ref);
}

/** Archives the flag once nothing it serves is needed. */
export async function archiveFlag(deps: Deps, {content: ref}: ActionParams['archiveFlag']): Promise<StatusResult> {
  const {link, fx} = await requireLinked(deps, ref, {ended: true});
  const ended = link.conclusion;
  if (!ended) throw new ActionError('not_ended', 'End the experiment before archiving its flag.');
  if (ended.shipVia === 'fx') {
    throw new ActionError(
      'flag_in_use',
      'The winner is served by this flag. Archiving it would send every visitor back to the original page.',
    );
  }
  await fx.archiveFlag(link.flagKey);
  await saveLink({...link, conclusion: {...ended, archived: true}});
  logger.info('Flag archived', {content: link.contentKey, flag: link.flagKey});
  return getStatus(deps, ref);
}

export async function listAudiences({fx}: Deps): Promise<AudienceOption[]> {
  if (!fx.sdkKey) return [];
  return datafileAudiences(await fetchDatafile(fx.sdkKey));
}

/** Flags the site would treat as CMS-driven, with their A/B rules, for "Link an existing flag". */
export async function listCmsFlags({fx, profile}: Deps): Promise<CmsFlagOption[]> {
  const [flags, links] = await Promise.all([fx.listFlags(), listLinks()]);
  const linked = new Set(links.map((l) => l.flagKey));
  return flags
    .filter((f) => f.variable_definitions?.[profile.markerVariable]?.type === 'boolean')
    .map((f) => ({
      flagKey: f.key,
      name: f.name,
      rules: (f.environments?.[fx.environmentKey]?.rules_detail ?? [])
        .filter((r) => r.type === 'a/b')
        .map((r) => ({key: r.key, name: r.name || r.key, enabled: Boolean(r.enabled)})),
      linked: linked.has(f.key),
    }))
    .filter((f) => f.rules.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listExperiments(deps: Deps): Promise<ExperimentRow[]> {
  const links = await listLinks();
  const rows: ExperimentRow[] = [];
  // A few at a time: each link is three FX calls, and FX rate-limits bursts.
  for (let i = 0; i < links.length; i += 4) {
    rows.push(
      ...(await Promise.all(
        links.slice(i, i + 4).map(async (link) => {
          if (link.conclusion?.archived) return {link, rule: null, error: null};
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

/** Removes a link from the Experiments view, e.g. one whose page or flag is gone. Nothing changes in FX. */
export async function forgetLink(deps: Deps, {contentKey, locale}: ActionParams['forgetLink']): Promise<ExperimentRow[]> {
  await removeLink(contentKey, locale);
  return listExperiments(deps);
}
