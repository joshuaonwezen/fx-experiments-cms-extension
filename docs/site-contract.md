# What a site needs for the Feature Experimentation extension

The extension creates Feature Experimentation (FX) flags whose variations are CMS variations of a page. It never configures your site. Instead, your site follows one convention, described on this page, and any site that does works with the extension. A walkthrough of a site built this way: [how the site side works](https://opti.joshuaonwezen.dev/demo/feature-experimentation).

The names used below (`cms_flag`, `cms_route`, `control`, `wx`, `wx_`, `--` and the preview path) are the defaults in `DEFAULT_PROFILE` in `src/shared/profile.ts`. If your site uses other names, change that one object and redeploy the app. Installs have no site settings.

## The flow on each request

1. **Decide.** Create an FX user context for the visitor and decide every flag (`decideAll`, or `decide` per flag), with the SDK key saved in the extension's settings. Use a visitor ID that stays the same across requests, such as a first-party cookie, or visitors are re-bucketed on every page view. Turn impressions off here (`DISABLE_DECISION_EVENT`); step 4 sends them.
2. **Keep the decisions that drive CMS content.** A decision applies to the page when all of these hold:
   - it is enabled and its variation key is not `off`;
   - its `cms_flag` variable is the boolean `true`;
   - its `cms_route` variable covers the request path (see [Route syntax](#route-syntax)).
3. **Fetch the page with the decided variation keys.** Ask Optimizely Graph for the page with a variation filter that names the decided keys and keeps the original page as the fallback:
   ```graphql
   variation: { include: SOME, value: ["<variation-key>"], includeOriginal: true }
   ```
   Serve the item whose `_metadata.variation` is a decided key, or else the item with no variation. Don't rely on the order Graph returns them in. With `@optimizely/cms-sdk` 3.x, send this query with `stored: false`: a stored query template keeps answering with the first variation it was registered with.
4. **Send the impression where the variation renders.** In the code that renders the page, decide the flag again with impressions on. Do this for `control` as well.
5. **Cache per decision.** If pages are cached (a CDN, static regeneration), the decision has to be part of the cache key, or one visitor's variation is served to everyone. One way: rewrite the request internally to `<path>/__v_<flag>--<variation>`, one segment per kept decision, sorted, and render from that path.

## The flag

- **A boolean marker variable** (`cms_flag`). The site applies a flag to CMS content only when the decided variation's value is `true`. It must be of type boolean: a string `"true"` does not count, and the extension ignores such flags too.
- **A string route variable** (`cms_route`). The site applies the flag only on the request paths it covers.
- The extension sets both as variable **defaults**, so a variation added later in FX inherits them. A flag may also set them per variation; the extension reads the effective value either way.
- **Routes the extension suggests.** For a page's primary language it suggests both forms of the URL, for example `/offers` and `/en/offers`, so the test applies whether or not your site prefixes its default language. A form your site doesn't use costs nothing. A translation keeps the URL the CMS reports, for example `/nl/offers`.

### Route syntax

| Value | Matches |
|---|---|
| empty | every path |
| `/*` | every path |
| `/offers` | `/offers` and `/offers/` only |
| `/products/*` | `/products` and everything under it |
| `/a, /b/*` | any of the entries |

Match against the **raw request path**: the path the visitor asked for, before any internal rewrite, without the query string. Matching is case-sensitive and ignores trailing slashes. A matcher that behaves like the extension's:

```ts
function routeMatches(pathname: string, route?: string): boolean {
  if (!route || !route.trim()) return true;
  const path = pathname.replace(/\/$/, '') || '/';
  return route.split(',').some((raw) => {
    const entry = raw.trim();
    if (!entry) return false;
    if (entry === '/*') return true;
    if (entry.endsWith('/*')) {
      const prefix = entry.slice(0, -2).replace(/\/$/, '') || '/';
      return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
    }
    return path === (entry.replace(/\/$/, '') || '/');
  });
}
```

## Variations

- **The CMS variation name is the FX variation key**, exactly, case included. There is no mapping table. FX keys allow letters, digits, `_` and `-`, up to 64 characters; the extension flags CMS variation names it can't use so editors can rename them.
- **`control` serves the original page.** No CMS variation may use that name, so Graph returns the original page for it. The site must still send an impression for `control`, or the baseline group counts zero visitors.
- **Reserved names.**
  - `off` and `on` are FX's own variation keys, and `control` is the original page. No CMS variation may use them.
  - The flag key `wx` and CMS variation names starting `wx_` are kept for CMS variations driven by Web Experimentation. The extension never adds a `wx_*` variation to a test, warns when a page has one, and won't create a flag named `wx`. If your site has no such setup, these cost nothing.
- **The URL separator.** If your site puts decisions in the path as `__v_<flag>--<variation>`, neither key may contain `--`. The extension enforces this for flag keys and CMS variation names.

## Serving and measuring

- **Decide with the SDK key the extension reads.** The extension reads that key's datafile to find the project and environment, to see when a test is live, and to show audiences by name. A site that decides with a different environment's key never sees the test.
- **Serve only published variations.** The extension refuses to start a test while any variation in it is unpublished, because visitors in that group would see the original page while being counted as the variation.
- **Send impressions where the variation renders**, and check that impressions and conversions reach FX (requests to `logx.optimizely.com`).
- **Track the metrics editors pick** with `trackEvent` and the same event keys as the FX project's events.
- **One change per page at a time.** The readiness checklist warns when another experiment or a targeted delivery also applies to the page, since visitors could get both.

## Ending a test

- **Serve it to everyone from FX** pauses the A/B rule and adds a targeted delivery of the winning variation (`<flag>_winner`) to the same flag. The site must apply delivery decisions the same way as A/B decisions. `decideAll` and `decide` already do, as long as the site doesn't filter decisions by rule type.
- **Make it the page in the CMS** publishes a new version of the page with the winning variation's content. Nothing is needed from the site.

## Previews (optional)

Preview links use `{path}/__v_{flag}--{variation}` on the page's public URL, for example `https://www.example.com/offers/__v_cms_offers--bold_hero`, or `https://www.example.com/__v_cms_offers--bold_hero` for the home page. To support them, the site treats such a segment as a forced decision for that flag and renders that variation.

Validate the segment before serving it: the flag must exist and the variation must belong to one of its running rules. Otherwise anyone can create new cached pages by editing the URL. A site that validates against the live datafile can preview a variation only while the test runs, which is when the panel shows Preview links.

A site without such a URL sets `previewPath` to `''` in `DEFAULT_PROFILE`, and the links are hidden.

## The page's public URL

Preview links and suggested routes come from the page's public URL as the CMS reports it, so the CMS application's host must be the site's address.
