import {FULL_TRAFFIC} from './constants';
import {FX_KEY_PATTERN, reservedVariationKeys, type SiteProfile} from './profile';

export {FX_KEY_PATTERN};

/** Why `key` can't be used as an FX flag key, or null when it can. */
export function flagKeyProblem(key: string, profile: SiteProfile): string | null {
  if (!key) return 'Required.';
  if (!FX_KEY_PATTERN.test(key)) return 'Use letters, digits, _ or - (max 64).';
  if (key.includes(profile.keySeparator)) return `Can't contain "${profile.keySeparator}" (the site's URL separator).`;
  if (profile.reservedFlagKeys.includes(key)) return `"${key}" is reserved by the site.`;
  return null;
}

/** The reserved prefix `name` starts with, or null. Such variations belong to another tool. */
export function reservedPrefixOf(name: string, profile: SiteProfile): string | null {
  return profile.reservedVariationPrefixes.find((p) => name.startsWith(p)) ?? null;
}

/**
 * Why a CMS variation name can't be mirrored to FX, or null when it can. The site
 * requires the CMS variation name to equal the FX variation key exactly, so a name that
 * isn't a valid key has to be renamed in the CMS - there is no mapping to fall back on.
 */
export function variationNameProblem(name: string, profile: SiteProfile): string | null {
  if (reservedVariationKeys(profile).includes(name)) {
    return `"${name}" is reserved in FX. Rename the CMS variation.`;
  }
  const prefix = reservedPrefixOf(name, profile);
  if (prefix) return `Names starting "${prefix}" are run by another tool, not Feature Experimentation.`;
  if (!FX_KEY_PATTERN.test(name)) {
    return 'Not a valid FX key (letters, digits, _ or -). Rename the CMS variation.';
  }
  if (name.includes(profile.keySeparator)) return `Contains "${profile.keySeparator}". Rename the CMS variation.`;
  return null;
}

export interface Arm {
  key: string;
  weight: number;
}

/**
 * An even split of FULL_TRAFFIC across `keys` (duplicates dropped). Basis points don't
 * always divide evenly; the remainder goes to the first key - control, when the caller
 * puts it first - so the total is exactly FULL_TRAFFIC, which the Flags API requires.
 */
export function splitTraffic(keys: string[]): Arm[] {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const share = Math.floor(FULL_TRAFFIC / unique.length);
  const remainder = FULL_TRAFFIC - share * unique.length;
  return unique.map((key, i) => ({key, weight: share + (i === 0 ? remainder : 0)}));
}

/** `arms` scaled to sum to `total`, keeping their proportions; the rounding remainder goes to the first. */
function scale(arms: Arm[], total: number): Arm[] {
  if (arms.length === 0) return [];
  const sum = arms.reduce((s, a) => s + a.weight, 0);
  // All-zero weights have no proportions to keep: split evenly.
  const scaled = arms.map((a) => ({
    key: a.key,
    weight: sum > 0 ? Math.floor((a.weight * total) / sum) : Math.floor(total / arms.length),
  }));
  scaled[0].weight += total - scaled.reduce((s, a) => s + a.weight, 0);
  return scaled;
}

/**
 * Adds `newKeys` to a rule's arms. Each new arm gets an even share of the total; the
 * existing arms give that up in proportion, so a custom split (say 50/25/25) keeps its
 * shape instead of being flattened. Equal arms stay (nearly) equal.
 */
export function addArms(existing: Arm[], newKeys: string[]): Arm[] {
  const adding = [...new Set(newKeys)].filter((k) => !existing.some((a) => a.key === k));
  if (adding.length === 0) return existing;
  if (existing.length === 0) return splitTraffic(adding);
  const share = Math.floor(FULL_TRAFFIC / (existing.length + adding.length));
  const kept = scale(existing, FULL_TRAFFIC - share * adding.length);
  return [...kept, ...adding.map((key) => ({key, weight: share}))];
}

/** Drops `keys` from the rule's arms and gives their traffic back in proportion. */
export function removeArms(existing: Arm[], keys: string[]): Arm[] {
  return scale(
    existing.filter((a) => !keys.includes(a.key)),
    FULL_TRAFFIC,
  );
}

/** Control first, then the challengers - the order a new rule's variations go in. */
export function experimentKeys(variationNames: string[], controlKey: string): string[] {
  return [controlKey, ...variationNames.filter((n) => n !== controlKey)];
}

const MAX_ROUTE_LENGTH = 1000;

/** Why `route` can't be a route variable value, or null. Mirrors routeMatches() in the site's middleware. */
export function routeProblem(route: string): string | null {
  if (route.length > MAX_ROUTE_LENGTH) return `Keep it under ${MAX_ROUTE_LENGTH} characters.`;
  const entries = route.split(',').map((e) => e.trim());
  if (!route.trim() || entries.some((e) => !e)) return 'Required (e.g. /savings, /products/*).';
  if (entries.some((e) => !e.startsWith('/'))) return 'Each route must start with "/".';
  if (entries.some((e) => /\s/.test(e))) return 'Routes cannot contain spaces.';
  if (entries.some((e) => e.includes('*') && !e.endsWith('/*'))) return 'Wildcards are only supported as a trailing "/*".';
  return null;
}

/** One route entry, the way the site's routeMatches() reads it. */
type RouteEntry = {kind: 'all'} | {kind: 'exact'; path: string} | {kind: 'prefix'; path: string};

const stripSlash = (p: string) => p.replace(/\/+$/, '') || '/';

function routeEntries(route: string): RouteEntry[] {
  // An absent or empty route matches every path.
  if (!route.trim()) return [{kind: 'all'}];
  return route
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((entry): RouteEntry => {
      if (entry === '/*') return {kind: 'all'};
      if (entry.endsWith('/*')) return {kind: 'prefix', path: stripSlash(entry.slice(0, -2))};
      return {kind: 'exact', path: stripSlash(entry)};
    });
}

function underPrefix(path: string, prefix: string): boolean {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

function entriesOverlap(a: RouteEntry, b: RouteEntry): boolean {
  if (a.kind === 'all' || b.kind === 'all') return true;
  if (a.kind === 'exact' && b.kind === 'exact') return a.path === b.path;
  if (a.kind === 'exact') return underPrefix(a.path, b.path);
  if (b.kind === 'exact') return underPrefix(b.path, a.path);
  return underPrefix(a.path, b.path) || underPrefix(b.path, a.path);
}

/**
 * Whether some path is covered by both route values, i.e. the site would put a
 * visitor into both flags on the same page.
 */
export function routesOverlap(a: string, b: string): boolean {
  const left = routeEntries(a);
  const right = routeEntries(b);
  return left.some((x) => right.some((y) => entriesOverlap(x, y)));
}

/** Whether the site applies a flag with this route on `path` (the raw request path). */
export function routeCovers(route: string, path: string): boolean {
  const target = stripSlash(path);
  return routeEntries(route).some((e) =>
    e.kind === 'all' ? true : e.kind === 'prefix' ? underPrefix(target, e.path) : e.path === target,
  );
}

/**
 * The paths visitors request this page on. The CMS's public URL is a starting point
 * only: instances differ on whether default-language URLs carry the locale prefix, and
 * the site's router compares the raw request path, so a route built from the wrong form
 * never applies. Other languages keep the form the CMS reports.
 */
export function visitorPaths(publicUrl: string | undefined, locale: string, profile: SiteProfile): string[] {
  if (!publicUrl) return [];
  let pathname: string;
  try {
    pathname = new URL(publicUrl, 'https://placeholder.invalid').pathname;
  } catch {
    return [];
  }
  const path = stripSlash(pathname);
  if (locale.toLowerCase() !== profile.defaultLocale.toLowerCase()) return [path];

  const segments = path.split('/').filter(Boolean);
  const prefixed = segments[0]?.toLowerCase() === locale.toLowerCase();
  const bare = prefixed ? `/${segments.slice(1).join('/')}` : path;
  const withPrefix = `/${prefixed ? segments[0] : locale.toLowerCase()}${bare === '/' ? '' : bare}`;
  if (profile.defaultLocaleUrls === 'bare') return [bare];
  if (profile.defaultLocaleUrls === 'prefixed') return [withPrefix];
  return [bare, withPrefix];
}

/** The route suggested for a new experiment on this page. */
export function defaultRoute(publicUrl: string | undefined, locale: string, profile: SiteProfile): string {
  return visitorPaths(publicUrl, locale, profile).join(', ');
}

/** The visitor paths `route` does not cover. */
export function uncoveredPaths(route: string, paths: string[]): string[] {
  return paths.filter((p) => !routeCovers(route, p));
}

/** `route` extended with whichever of `paths` it doesn't cover yet. */
export function withPaths(route: string, paths: string[]): string {
  const missing = uncoveredPaths(route, paths);
  if (missing.length === 0) return route;
  return [route.trim(), ...missing].filter(Boolean).join(', ');
}

/** A URL that shows `variation` on the live site, or null when the site has no preview path. */
export function previewUrl(
  publicUrl: string | undefined,
  path: string,
  flagKey: string,
  variation: string,
  profile: SiteProfile,
): string | null {
  if (!publicUrl || !profile.previewPath) return null;
  let origin: string;
  try {
    origin = new URL(publicUrl).origin;
  } catch {
    return null;
  }
  const basePath = path === '/' ? '' : path;
  const rendered = profile.previewPath
    .replace('{path}', basePath)
    .replace('{flag}', encodeURIComponent(flagKey))
    .replace('{variation}', encodeURIComponent(variation));
  return `${origin}${rendered.startsWith('/') ? '' : '/'}${rendered}`;
}

/** `cms_` + a snake_case slug of the page name, trimmed to a valid key. */
export function defaultFlagKey(displayName: string | undefined, fallback: string): string {
  const slug = (displayName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `cms_${slug || fallback}`.slice(0, 64).replace(/_+$/, '');
}

/** Comma-separated audience ids → numbers, ignoring blanks and junk. */
export function parseAudienceIds(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

/** Content keys arrive with or without dashes; the API and the link store want one form. */
export function normalizeKey(key: string): string {
  return key.replace(/-/g, '').toLowerCase();
}
