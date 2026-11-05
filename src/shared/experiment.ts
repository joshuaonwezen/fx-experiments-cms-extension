import {CONTROL_VARIATION_KEY, FLAG_VAR_SEP, FULL_TRAFFIC, RESERVED_VARIATION_KEYS} from './constants';

// FX keys: letters, digits, underscores and hyphens, max 64.
const FX_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Why `key` can't be used as an FX flag key, or null when it can. */
export function flagKeyProblem(key: string): string | null {
  if (!key) return 'Required.';
  if (!FX_KEY_PATTERN.test(key)) return 'Use letters, digits, _ or - (max 64).';
  if (key.includes(FLAG_VAR_SEP)) return `Can't contain "${FLAG_VAR_SEP}" (the site's URL separator).`;
  return null;
}

/**
 * Why a CMS variation name can't be mirrored to FX, or null when it can. The site
 * requires the CMS variation name to equal the FX variation key exactly, so a name that
 * isn't a valid key has to be renamed in the CMS - there is no mapping to fall back on.
 */
export function variationNameProblem(name: string): string | null {
  if ((RESERVED_VARIATION_KEYS as readonly string[]).includes(name)) {
    return `"${name}" is reserved in FX. Rename the CMS variation.`;
  }
  if (!FX_KEY_PATTERN.test(name)) {
    return 'Not a valid FX key (letters, digits, _ or -). Rename the CMS variation.';
  }
  if (name.includes(FLAG_VAR_SEP)) return `Contains "${FLAG_VAR_SEP}". Rename the CMS variation.`;
  return null;
}

/**
 * An even split of FULL_TRAFFIC across `keys` (duplicates dropped). Basis points don't
 * always divide evenly; the remainder goes to the first key - control, when the caller
 * puts it first - so the total is exactly FULL_TRAFFIC, which the Flags API requires.
 */
export function splitTraffic(keys: string[]): Array<{key: string; weight: number}> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const share = Math.floor(FULL_TRAFFIC / unique.length);
  const remainder = FULL_TRAFFIC - share * unique.length;
  return unique.map((key, i) => ({key, weight: share + (i === 0 ? remainder : 0)}));
}

/** Control first, then the challengers - the order a new rule's variations go in. */
export function experimentKeys(variationNames: string[]): string[] {
  return [CONTROL_VARIATION_KEY, ...variationNames.filter((n) => n !== CONTROL_VARIATION_KEY)];
}

/** Why `route` can't be a cms_route value, or null. Mirrors routeMatches() in the site's middleware. */
export function routeProblem(route: string): string | null {
  const entries = route.split(',').map((e) => e.trim());
  if (!route.trim() || entries.some((e) => !e)) return 'Required (e.g. /savings, /products/*).';
  if (entries.some((e) => !e.startsWith('/'))) return 'Each route must start with "/".';
  if (entries.some((e) => e.includes('*') && !e.endsWith('/*'))) return 'Wildcards are only supported as a trailing "/*".';
  return null;
}

/** One cms_route entry, the way the site's routeMatches() reads it. */
type RouteEntry = {kind: 'all'} | {kind: 'exact'; path: string} | {kind: 'prefix'; path: string};

function routeEntries(route: string): RouteEntry[] {
  // An absent or empty cms_route matches every route.
  if (!route.trim()) return [{kind: 'all'}];
  const strip = (p: string) => p.replace(/\/$/, '') || '/';
  return route
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((entry): RouteEntry => {
      if (entry === '/*') return {kind: 'all'};
      if (entry.endsWith('/*')) return {kind: 'prefix', path: strip(entry.slice(0, -2))};
      return {kind: 'exact', path: strip(entry)};
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
 * Whether some path is covered by both cms_route values, i.e. the site would put a
 * visitor into both flags on the same page. Uses the matching rules of routeMatches()
 * in the site's middleware.
 */
export function routesOverlap(a: string, b: string): boolean {
  const left = routeEntries(a);
  const right = routeEntries(b);
  return left.some((x) => right.some((y) => entriesOverlap(x, y)));
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

/**
 * The route the site's middleware matches for this page: the path of its public URL,
 * without a trailing slash (root stays "/"). Middleware compares against the clean
 * request path, so this is only a starting point - instances differ on whether URLs
 * carry a locale prefix, and the editor can change it.
 */
export function defaultRoute(publicUrl: string | undefined): string {
  if (!publicUrl) return '';
  let pathname: string;
  try {
    pathname = new URL(publicUrl, 'https://placeholder.invalid').pathname;
  } catch {
    return '';
  }
  return pathname.replace(/\/+$/, '') || '/';
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
