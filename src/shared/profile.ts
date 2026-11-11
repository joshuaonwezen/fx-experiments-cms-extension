// How the site maps FX decisions to CMS content. This is the extension's convention,
// not a setting: a site follows it (docs/site-contract.md), so installs need nothing
// beyond credentials. A site with different names is a change to this one object.

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
  previewPath: '{path}/__v_{flag}--{variation}',
};

// FX variable and variation keys: letters, digits, underscores and hyphens, max 64.
export const FX_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** FX variation keys no CMS variation may use: FX's own `off`/`on` and the control arm. */
export function reservedVariationKeys(profile: SiteProfile): string[] {
  return ['off', 'on', profile.controlKey];
}
