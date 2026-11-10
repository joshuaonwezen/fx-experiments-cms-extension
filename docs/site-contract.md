# What a site needs for this extension

The extension creates Feature Experimentation flags whose variations are CMS variations. It works with any site
that turns an FX decision into "show this CMS variation of the page". This page lists what such a site has to do.
optimizely-nextjs-demo is the reference implementation; the names in brackets are its defaults, and every one of
them can be changed in the app's **Site convention** settings.

## The flag

- **A boolean marker variable** (`cms_flag`). The site applies a flag to CMS content only when the decided
  variation's value is `true`. It must be of type boolean: a string `"true"` does not count.
- **A string route variable** (`cms_route`). The site applies the flag only on request paths it covers.
  The extension sets both as variable **defaults**, so a variation added later in FX inherits them. A flag may also
  set them per variation; the extension reads the effective value either way.
- **Decide on the raw request path.** The extension suggests routes for the URLs visitors actually request, using
  the "Default-language URLs" setting (`/page`, `/en/page`, or both). A route that only covers one form misses the
  other.

### Route syntax

The site must read the route variable like this (optimizely-nextjs-demo: `routeMatches()` in `src/middleware.ts`):

| Value | Matches |
|---|---|
| empty | every path |
| `/*` | every path |
| `/savings` | `/savings` and `/savings/` only |
| `/products/*` | `/products` and everything under it |
| `/a, /b/*` | any entry |

Matching is case-sensitive and ignores trailing slashes and the query string.

## Variations

- **The CMS variation name is the FX variation key**, exactly, case included. There is no mapping table.
- **One FX variation serves the original page** (`control`). No CMS variation may use that name, nor FX's own `off`
  and `on`. The site should still record an impression for it, or the baseline group counts zero visitors.
- **Keys must not contain the site's URL separator** (`--`) if the site encodes decisions in the path.
- **Reserved names.** A site that uses some variation names for another tool (`wx_*` for Web Experimentation in
  optimizely-nextjs-demo) lists their prefix; the extension never adds those to a test and warns when a page has
  them. Flag keys the site reserves (`wx`) cannot be used.

## Serving and measuring

- **Serve only published variations.** The extension refuses to start a test while any variation in it is
  unpublished, because visitors in that group would see the original page while being counted as the variation.
- **Fire the impression in the component that renders the variation**, and check that impressions and conversions
  reach FX (requests to `logx.optimizely.com`).
- **Track the metrics you pick** with the same event keys as the FX project's events.

## Ending a test

- **Serve it to everyone from FX** adds a targeted delivery of the winning variation to the same flag. The site must
  apply delivery rules the same way as A/B rules (optimizely-nextjs-demo does; it decides every rule with
  `decideAll`).
- **Make it the page in the CMS** publishes a new version of the page with the winning variation's content. Nothing
  is needed from the site.

## Previews

The optional **Preview path** (`{path}/__v_{flag}--{variation}`) is a URL that shows one variation on the live
site. Leave it as `none` if the site has no such URL. In optimizely-nextjs-demo the preview only works while the
test runs, because the site checks the variation against the live datafile.
