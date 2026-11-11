# Feature Experimentation

Turn the CMS variations of a page into a Feature Experimentation (FX) A/B test without leaving the editor. Pick the variations, a metric and who takes part, start the test, watch the results in the panel, and end it by serving the winner from FX or publishing it as the page.

Documentation: [walkthrough](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#fx-experiments) and [how the site side works](https://opti.joshuaonwezen.dev/demo/feature-experimentation).

## What editors get

### Feature Experimentation sidebar (per page)
- Lists the page's CMS variations and shows which one is open.
- **Create experiment** asks for three things: the variations, the metric, and who takes part (audiences by name, traffic %). It then creates:
  - **the flag**, with the `cms_flag` and `cms_route` variables set as defaults, so a variation added later in FX inherits them. Flag key, name and route are suggested and sit under *Advanced*;
  - **a route** covering every URL visitors use for the page: with and without the language prefix for the page's primary language, and the URL the CMS reports for a translation;
  - **one FX variation per CMS variation**, plus `control` for the original page;
  - **an A/B rule** with an even split, the traffic %, audiences and metrics. It can start straight away.
- **Readiness checklist** before starting: the page and every variation in the test are published (Start is refused otherwise), a metric is set, the route covers the page's URLs (with a one-click fix), nothing else in FX changes the page (other experiments and targeted deliveries), and no variations from another tool are on the page.
- **Once the test is linked:**
  - Start and pause. After starting, the panel checks the site's datafile until the test is live.
  - **Results in the panel:** visitors, conversion rate and lift per variation for the primary metric, with significant lifts marked and a significant winner named. **Full results in FX** opens FX's own results page.
  - A table of CMS variations and FX variations with **Preview** links on the live site, **Remove** per variation, and **Add to experiment** for new CMS variations. Adding keeps a custom split's proportions. On a running test both ask first.
  - Edit traffic, audiences, metrics (the first is primary; new events can be created inline) and the route.
- **End experiment** shows the results and preselects a significant winner. Pick the winner (or no winner), then either:
  - **serve it to everyone from FX:** pauses the A/B rule and adds a targeted delivery of the winner, or
  - **make it the page in the CMS:** publishes a new version of the page with the winner's content. An approval workflow is respected; the step resumes once the version is approved.

  Afterwards it can **delete the test's variations** from the CMS (only when an admin has turned that on, after a typed confirmation, and never a variation another live rule still serves) and **archive the flag**.
- **Link existing flag** adopts a flag from the project's CMS flags. **Unlink** removes the link only; nothing changes in FX.

### Experiments view
Every linked experiment on the CMS instance: status (including ended tests and their winner), split, primary metric, start and pause, links to the results and the flag, clean-up of links whose flag is gone, and the CMS flags in FX that no page links to.

## Setup

1. Install the app on the CMS instance (see [Deploy](#deploy)). The app is CMS-scoped, so each CMS instance gets its own install.
2. Fill in the two settings sections. Nothing about the site is configured: the site follows the convention in [What your site needs](#what-your-site-needs).
3. Open a page that has variations. The **Feature Experimentation** panel is on the editor's right-hand rail, and **Experiments** is under Extensions in the navigation rail.

| Setting | Required | Where to find it | Used for |
|---|---|---|---|
| Personal access token | Yes | FX: Profile > API Access > Generate new token | Creating and changing flags, rules and events, and reading results. Needs write access to the project's flags and events. |
| Site SDK key | Yes | FX: Settings > Environments | The key your site decides with. The project and environment are read from its datafile, so experiments land where the site looks. Also used to check that a test is live and to show audiences by name. |
| CMS client ID and secret | Yes | CMS: Settings > API Keys | Reading the open item's versions to find its variations. Ending a test publishes and deletes content, so give the key content write access. |
| Let "End experiment" delete CMS variations | No (off) | This app's settings | Lets the end-of-test step delete the test's variations. Deleting is permanent. |

Using the extension on another CMS instance: [reuse](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse). Something not working: [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting).

## What your site needs

The extension works with any site that serves CMS variations by FX decision this way. The full contract, with the route syntax and a sample matcher, is in [docs/site-contract.md](docs/site-contract.md).

- **Decide with the SDK key saved in the settings**, for a visitor ID that stays the same across requests.
- **Apply a decision to CMS content only when** it is enabled, its variation key isn't `off`, its boolean `cms_flag` variable is `true`, and its string `cms_route` variable covers the request path. The route is a comma-separated list: an exact path, a prefix ending in `/*`, or empty for every page. It is matched against the raw request path, case-sensitive, with trailing slashes ignored.
- **The CMS variation name is the FX variation key**, exactly. Fetch the page from Optimizely Graph with the decided key as a variation filter and the original page as fallback.
- **`control` serves the original page** and must still record an impression, or the baseline counts zero visitors.
- **Reserved names:** `off`, `on` and `control` as variation names; the flag key `wx` and variation names starting `wx_` (kept for Web Experimentation). If the site puts decisions in the URL as `__v_<flag>--<variation>` path segments, no flag or variation key may contain `--`.
- **Fire the impression where the variation renders**, and track the metrics with the same event keys as the FX project.
- **Apply targeted deliveries like A/B rules.** Ending a test from FX serves the winner through a targeted delivery on the same flag.
- **Optional preview URL:** `{path}/__v_{flag}--{variation}` shows one variation on the live site. The panel shows Preview links only while the test runs.

A site with different variable or variation names changes `DEFAULT_PROFILE` in `src/shared/profile.ts` and redeploys the app; it is not a setting.

## Limits

These come from the CMS UI extensions platform (beta, SDK 1.1.0) and the CMS API:

- **The editor's own Variations menu can't be extended.** Extensions get a sidebar, a view or a property editor.
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend maps the version to its variation through the CMS REST API. There is no editor identity, so changes are logged without a user name.
- **The CMS API can't create variations.** Create them in the editor's Variations menu, then add them to the test here.
- **The CMS API can't delete a published version.** Ending a test deletes a variation's other versions; a published one the CMS keeps is listed with the reason, and is no longer served.
- **Extensions get no CMS token.** The app stores its own CMS API client in its settings.
- **One FX project and environment per install**, the ones the saved SDK key belongs to.
- **Preview links and suggested routes come from the page's public URL**, so the CMS application's host must be the site's address.

## Security

- Every action's parameters are checked against allow-lists in `src/backend/lib/validate.ts` before any FX or CMS call, because they end up in API URL paths and JSON Patch pointers. Keys read back from storage are checked again.
- Every change the backend makes is written to the app's logs as an `audit` line (`ocp app logs`), without a user name since the platform doesn't provide one.
- Deleting CMS content is off until an admin turns it on, needs a typed confirmation, and the backend re-computes the list it is asked to delete and refuses if it differs from the one the editor confirmed.
- Secrets (the FX token and the CMS client secret) are stored in the app's secret settings fields and never sent to the browser.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev            # sidebar + view in a simulated CMS host, calling the local backend
```

The live suites in `tests/live/` call the real FX and CMS APIs in the `production` environment. They create throwaway flags (`cms_ext_smoke_*`, `cms_ext_e2e_*`) on scratch routes and archive them afterwards, and never publish or delete CMS content. The end-to-end suite reads one page's variations: point the `content` constant at the top of `tests/live/experiments.live.test.ts` at a page with published variations on your instance first.

```bash
FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=<fx-token> OPTIMIZELY_FX_PROJECT_ID=<project-id> FX_LIVE_SDK_KEY=<sdk-key> \
OPTIMIZELY_CMS_CLIENT_ID=<client-id> OPTIMIZELY_CMS_CLIENT_SECRET=<client-secret> yarn vitest run tests/live
```

`FX_LIVE_AUDIENCE_IDS=<id>,<id>` optionally adds audiences to the smoke test's rule.

## Deploy

With the OCP CLI (run it as `npx -p @optimizely/ocp-cli-v2 ocp ...` if it isn't installed):

```bash
npx -p @optimizely/ocp-cli-v2 ocp app register      # once
ocp app prepare --bump-dev-version --publish
ocp directory install fx_cms_experiments@<version> --scope <cms-instance-uuid>
```

Publishing a new dev version moves existing installs onto it.

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router, using the `{action, params}` → `{ok, result}` envelope; validates params and logs changes |
| `src/backend/lib/validate.ts` | One parser per action: allow-lists for every parameter |
| `src/backend/lib/experiments.ts` | The actions: create, sync/remove variations, metrics, traffic, audiences, route, start/pause, end, delete, archive, link, list |
| `src/backend/lib/datafile.ts` | The site's datafile: live CMS rules (with per-variation variables), live check, audiences |
| `src/backend/lib/fx.ts` | Flags API v1 and v2 events client |
| `src/backend/lib/results.ts` | Results summary: primary metric, lift, leader |
| `src/backend/lib/cms.ts` | CMS token, per-locale version listing, drafts, publish, delete |
| `src/backend/lib/links.ts` | Content → flag/rule links (and how a test ended) in the OCP KV store, one hash per install |
| `src/backend/lifecycle/Lifecycle.ts` | Validates the settings forms against FX, the datafile and the CMS before saving |
| `src/shared/profile.ts` | The site convention (`DEFAULT_PROFILE`) |
| `src/shared/` | The UI ↔ backend contract, key/route rules, traffic splits and the readiness checklist |
| `src/cms-ui-extensions/fx/` | `FxExperiment.sidebar.tsx`, `FxExperiments.view.tsx` and their panels |
