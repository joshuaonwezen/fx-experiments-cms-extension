export const CMS_EXTENSION_FUNCTION_ID = 'cms_extension';

// The FX variation that serves the page's original (base) content. The site treats it
// specially: it is never sent to Graph as a variation name, but it still fires the FX
// impression, so the baseline arm is counted. Must match CONTROL_VARIATION_KEY in
// optimizely-nextjs-demo/src/lib/optimizely/variationPath.ts.
export const CONTROL_VARIATION_KEY = 'control';

// FX creates `off` and `on` with every flag. `off` is the disabled bucket; neither can
// be a CMS variation name.
export const RESERVED_VARIATION_KEYS = ['off', 'on', CONTROL_VARIATION_KEY] as const;

// The site encodes decisions as `__v_<flagKey>--<variationKey>` path segments
// (variationPath.ts FLAG_VAR_SEP), so neither key may contain the separator.
export const FLAG_VAR_SEP = '--';

// Variation variables the site's middleware reads to decide whether a flag drives CMS
// content and on which route(s).
export const CMS_FLAG_VARIABLE = 'cms_flag';
export const CMS_ROUTE_VARIABLE = 'cms_route';

// FX traffic is expressed in basis points.
export const FULL_TRAFFIC = 10000;

export const FX_APP_BASE = 'https://app.optimizely.com/v2';
