import {FX_KEY_PATTERN, normalizeKey} from '../../shared/experiment';
import type {ActionName, ActionParams, ContentRef, ShipVia} from '../../shared/types';
import {ActionError} from './errors';

// Every value below ends up in an FX or CMS URL path, a JSON Patch pointer or the KV
// store, so each is checked against an allow-list here, before any handler runs.

const CONTENT_KEY = /^[0-9a-f]{32}$/;
const LOCALE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
const VERSION = /^\d{1,12}$/;
const EVENT_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_NAME = 200;
const MAX_URL = 2048;
const MAX_LIST = 50;

function invalid(field: string, why: string): never {
  throw new ActionError('invalid_input', `${field}: ${why}`);
}

function record(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(field, 'expected an object.');
  return raw as Record<string, unknown>;
}

function str(raw: unknown, field: string, {optional = false, max = MAX_NAME} = {}): string {
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return '';
    invalid(field, 'required.');
  }
  if (typeof raw !== 'string') invalid(field, 'expected text.');
  if (raw.length > max) invalid(field, `at most ${max} characters.`);
  return raw;
}

function bool(raw: unknown): boolean {
  return raw === true;
}

export function fxKey(raw: unknown, field: string): string {
  const value = str(raw, field, {max: 64}).trim();
  if (!FX_KEY_PATTERN.test(value)) invalid(field, 'letters, digits, _ or - (max 64).');
  return value;
}

function fxKeys(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) invalid(field, 'expected a list.');
  if (raw.length > MAX_LIST) invalid(field, `at most ${MAX_LIST}.`);
  return raw.map((v, i) => fxKey(v, `${field}[${i}]`));
}

function ids(raw: unknown, field: string): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid(field, 'expected a list.');
  if (raw.length > MAX_LIST) invalid(field, `at most ${MAX_LIST}.`);
  return raw.map((v) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) invalid(field, 'expected positive whole numbers.');
    return v;
  });
}

function percent(raw: unknown, field: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) invalid(field, 'between 1 and 100.');
  return n;
}

export function contentRef(raw: unknown): ContentRef {
  const ref = record(raw, 'content');
  const key = normalizeKey(str(ref.key, 'content.key', {max: 64}));
  if (!CONTENT_KEY.test(key)) invalid('content.key', 'not a CMS content key.');
  const locale = str(ref.locale, 'content.locale', {optional: true, max: 35});
  if (locale && !LOCALE.test(locale)) invalid('content.locale', 'not a locale code.');
  const version = str(ref.version, 'content.version', {optional: true, max: 12});
  if (version && !VERSION.test(version)) invalid('content.version', 'not a version number.');
  const publicUrl = str(ref.publicUrl, 'content.publicUrl', {optional: true, max: MAX_URL});
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) invalid('content.publicUrl', 'expected an http(s) URL.');
  return {key, locale, ...(version ? {version} : {}), ...(publicUrl ? {publicUrl} : {})};
}

/** Re-checks keys read back from the link store before they go into an FX URL or patch path. */
export function storedKeys(link: {flagKey: unknown; ruleKey: unknown; environmentKey: unknown}) {
  return {
    flagKey: fxKey(link.flagKey, 'stored flag key'),
    ruleKey: fxKey(link.ruleKey, 'stored rule key'),
    environmentKey: fxKey(link.environmentKey, 'stored environment key'),
  };
}

type Parsers = {[A in ActionName]: (raw: Record<string, unknown>) => ActionParams[A]};

const none = () => ({}) as Record<string, never>;

/** One parser per action: unknown fields are dropped, every kept field is checked. */
export const PARSERS: Parsers = {
  getStatus: (p) => ({content: contentRef(p.content)}),
  listEvents: none,
  createEvent: (p) => {
    const key = str(p.key, 'key', {max: 64}).trim();
    if (!EVENT_KEY.test(key)) invalid('key', 'letters, digits, _ . or - (max 64).');
    return {key, name: str(p.name, 'name', {optional: true}).trim() || key};
  },
  listAudiences: none,
  listCmsFlags: none,
  createExperiment: (p) => ({
    content: contentRef(p.content),
    displayName: str(p.displayName, 'displayName', {optional: true}),
    flagKey: fxKey(p.flagKey, 'flagKey'),
    flagName: str(p.flagName, 'flagName', {optional: true}),
    route: str(p.route, 'route', {max: 1000}),
    variations: fxKeys(p.variations, 'variations'),
    eventIds: ids(p.eventIds, 'eventIds'),
    audienceIds: ids(p.audienceIds, 'audienceIds'),
    trafficPercent: percent(p.trafficPercent, 'trafficPercent'),
    start: bool(p.start),
    confirmConflicts: bool(p.confirmConflicts),
  }),
  syncVariations: (p) => ({content: contentRef(p.content), confirmRunning: bool(p.confirmRunning)}),
  removeVariations: (p) => ({
    content: contentRef(p.content),
    variations: fxKeys(p.variations, 'variations'),
    confirmRunning: bool(p.confirmRunning),
  }),
  setMetrics: (p) => ({content: contentRef(p.content), eventIds: ids(p.eventIds, 'eventIds')}),
  setTraffic: (p) => ({content: contentRef(p.content), trafficPercent: percent(p.trafficPercent, 'trafficPercent')}),
  setAudiences: (p) => ({content: contentRef(p.content), audienceIds: ids(p.audienceIds, 'audienceIds')}),
  setRunning: (p) => ({content: contentRef(p.content), running: bool(p.running), confirmConflicts: bool(p.confirmConflicts)}),
  setRoute: (p) => ({content: contentRef(p.content), route: str(p.route, 'route', {max: 1000})}),
  linkExisting: (p) => ({
    content: contentRef(p.content),
    displayName: str(p.displayName, 'displayName', {optional: true}),
    flagKey: fxKey(p.flagKey, 'flagKey'),
    ...(p.ruleKey ? {ruleKey: fxKey(p.ruleKey, 'ruleKey')} : {}),
  }),
  unlink: (p) => ({content: contentRef(p.content), confirmRunning: bool(p.confirmRunning)}),
  endExperiment: (p) => {
    const winner = p.winner === null || p.winner === undefined ? null : fxKey(p.winner, 'winner');
    const shipVia = p.shipVia === 'fx' || p.shipVia === 'cms' ? (p.shipVia as ShipVia) : null;
    if (p.shipVia !== undefined && p.shipVia !== null && !shipVia) invalid('shipVia', 'fx or cms.');
    return {content: contentRef(p.content), winner, shipVia};
  },
  deleteVariations: (p) => ({content: contentRef(p.content), confirm: fxKeys(p.confirm, 'confirm')}),
  archiveFlag: (p) => ({content: contentRef(p.content)}),
  listExperiments: none,
  forgetLink: (p) => {
    const {key, locale} = contentRef({key: p.contentKey, locale: p.locale});
    if (!locale) invalid('locale', 'required.');
    return {contentKey: key, locale};
  },
};

export function isAction(action: string): action is ActionName {
  return Object.prototype.hasOwnProperty.call(PARSERS, action);
}
