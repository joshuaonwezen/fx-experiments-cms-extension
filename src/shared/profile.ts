// How the site maps FX decisions to CMS content. Every field is an app setting, and a
// blank setting falls back to the optimizely-nextjs-demo convention below, so an install
// that never touched the "Site convention" section behaves exactly as before.

export type LocaleUrlStyle = 'bare' | 'prefixed' | 'both';

export interface SiteProfile {
  /** Boolean flag variable that marks a flag as driving CMS content. */
  markerVariable: string;
  /** String flag variable holding the route(s) the site applies the flag on. */
  routeVariable: string;
  /** FX variation that serves the page's original (base) content. */
  controlKey: string;
  /** Flag keys the site reserves for something else (the demo's Web Experimentation bridge uses `wx`). */
  reservedFlagKeys: string[];
  /** CMS variation names with these prefixes belong to another tool and are never mirrored to FX. */
  reservedVariationPrefixes: string[];
  /** The site's separator between flag and variation key in URLs; neither key may contain it. */
  keySeparator: string;
  /** The site's default language. Its URLs may or may not carry a `/<locale>` prefix. */
  defaultLocale: string;
  /** Which URL form(s) visitors reach default-language pages on. */
  defaultLocaleUrls: LocaleUrlStyle;
  /**
   * Path that previews one variation on the live site, or '' when the site has none.
   * Placeholders: {path}, {flag}, {variation}.
   */
  previewPath: string;
}

export const DEFAULT_PROFILE: SiteProfile = {
  markerVariable: 'cms_flag',
  routeVariable: 'cms_route',
  controlKey: 'control',
  reservedFlagKeys: ['wx'],
  reservedVariationPrefixes: ['wx_'],
  keySeparator: '--',
  defaultLocale: 'en',
  defaultLocaleUrls: 'both',
  previewPath: '{path}/__v_{flag}--{variation}',
};

/** The settings section the profile is read from (keys match forms/settings.yml). */
export type SiteSettings = {
  markerVariable?: string;
  routeVariable?: string;
  controlKey?: string;
  reservedFlagKeys?: string;
  reservedVariationPrefixes?: string;
  keySeparator?: string;
  defaultLocale?: string;
  defaultLocaleUrls?: string;
  previewPath?: string;
};

// FX variable and variation keys: letters, digits, underscores and hyphens, max 64.
export const FX_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const URL_STYLES: readonly LocaleUrlStyle[] = ['bare', 'prefixed', 'both'];

function list(raw: string | undefined): string[] | null {
  if (raw === undefined || !raw.trim()) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Why the site settings can't be saved, per field, or {} when they can. */
export function siteSettingsProblems(s: SiteSettings): Partial<Record<keyof SiteSettings, string>> {
  const problems: Partial<Record<keyof SiteSettings, string>> = {};
  for (const field of ['markerVariable', 'routeVariable', 'controlKey'] as const) {
    const value = s[field]?.trim();
    if (value && !FX_KEY_PATTERN.test(value)) problems[field] = 'Letters, digits, _ or - (max 64).';
  }
  const marker = s.markerVariable?.trim() || DEFAULT_PROFILE.markerVariable;
  const route = s.routeVariable?.trim() || DEFAULT_PROFILE.routeVariable;
  if (marker === route) problems.routeVariable = 'Must differ from the marker variable.';
  for (const key of list(s.reservedFlagKeys) ?? []) {
    if (!FX_KEY_PATTERN.test(key)) problems.reservedFlagKeys = `"${key}" isn't a valid flag key.`;
  }
  for (const prefix of list(s.reservedVariationPrefixes) ?? []) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(prefix)) problems.reservedVariationPrefixes = `"${prefix}" isn't a valid prefix.`;
  }
  const separator = s.keySeparator?.trim();
  if (separator && (separator.length > 8 || /\s/.test(separator))) problems.keySeparator = 'Up to 8 characters, no spaces.';
  const locale = s.defaultLocale?.trim();
  if (locale && !LOCALE_PATTERN.test(locale)) problems.defaultLocale = 'A locale code such as en or en-GB.';
  const preview = s.previewPath?.trim();
  if (preview && preview !== 'none' && (!preview.startsWith('{path}') || !preview.includes('{variation}'))) {
    problems.previewPath = 'Start with {path} and include {variation}, or enter none.';
  }
  return problems;
}

/** The profile for these settings; blank fields take the default. Assumes siteSettingsProblems passed. */
export function toSiteProfile(s: SiteSettings = {}): SiteProfile {
  const text = (value: string | undefined, fallback: string) => value?.trim() || fallback;
  const style = s.defaultLocaleUrls?.trim() as LocaleUrlStyle | undefined;
  return {
    markerVariable: text(s.markerVariable, DEFAULT_PROFILE.markerVariable),
    routeVariable: text(s.routeVariable, DEFAULT_PROFILE.routeVariable),
    controlKey: text(s.controlKey, DEFAULT_PROFILE.controlKey),
    reservedFlagKeys: list(s.reservedFlagKeys) ?? DEFAULT_PROFILE.reservedFlagKeys,
    reservedVariationPrefixes: list(s.reservedVariationPrefixes) ?? DEFAULT_PROFILE.reservedVariationPrefixes,
    keySeparator: text(s.keySeparator, DEFAULT_PROFILE.keySeparator),
    defaultLocale: text(s.defaultLocale, DEFAULT_PROFILE.defaultLocale),
    defaultLocaleUrls: style && URL_STYLES.includes(style) ? style : DEFAULT_PROFILE.defaultLocaleUrls,
    // An explicit "none" turns preview links off; blank keeps the default.
    previewPath: s.previewPath?.trim() === 'none' ? '' : text(s.previewPath, DEFAULT_PROFILE.previewPath),
  };
}

/** FX variation keys no CMS variation may use: FX's own `off`/`on` and the control arm. */
export function reservedVariationKeys(profile: SiteProfile): string[] {
  return ['off', 'on', profile.controlKey];
}
