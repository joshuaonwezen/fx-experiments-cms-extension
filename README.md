# Feature Experimentation: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app, that turns a page's CMS variations into a Feature Experimentation A/B test from inside the editor, and ends it by shipping the winner.

It works with any site that follows its convention for serving CMS variations by FX decision. [docs/site-contract.md](docs/site-contract.md) lists what the site has to do; `optimizely-nextjs-demo` is the reference implementation. Installing takes credentials only: nothing about the site is configured. The convention in short:
- the CMS variation name equals the FX variation key;
- a flag drives CMS content when its marker variable (`cms_flag`) is true, on the paths in its route variable (`cms_route`).

## What it does

### Experiment sidebar (per page)
- Reads the open item's variations through the CMS REST API, and shows which variation you are editing.
- **Create experiment** takes three choices: the variations, the metric, and who takes part (audiences by name, traffic %).
  - **Flag:** the marker and route variables are set as *defaults*, so a variation added later in the FX UI inherits them. Flag key, name and route are suggested and sit under *Advanced*.
  - **Route:** suggested for every URL visitors use for the page: with and without the language prefix for the page's primary language, as the CMS reports it for translations.
  - **Variations:** one FX variation per chosen CMS variation, plus `control` for the original page.
  - **A/B rule:** an even split, the traffic %, the audiences and metrics. It can start straight away.
- **Readiness checklist** before starting: the page and every variation in the test are published (Start is refused otherwise, here and in the backend), a metric is set, the route covers the page's URLs (with a one-click fix), nothing else changes the page (other experiments *and* personalization deliveries), and no variations from another tool (`wx_*`) are on the page.
- **Once linked:**
  - Start / Pause. After starting, it checks the site's datafile until the test is live.
  - **Results in the panel:** visitors, conversion rate and lift per variation for the primary metric, with significant lifts marked and a significant winner named (`GET /v2/experiments/{layer_experiment_id}/results`). **Full results in FX** opens FX's own page in a new tab.
  - A CMS ↔ FX variation table with **Preview** links on the live site, **Remove** per variation, and **Add to experiment** for new CMS variations. Adding keeps a custom split's proportions. On a running test both ask first.
  - Edit traffic, audiences, metrics (the first is primary; new events can be created inline) and the route.
- **End experiment:** shows the results and preselects a significant winner; pick the winner (or no winner), then either
  - **serve it to everyone from FX:** pauses the A/B rule and adds a targeted delivery of the winner, or
  - **make it the page in the CMS:** publishes a new version of the page with the winner's content (an approval workflow is respected; the step resumes once it is approved).
  Afterwards it can **delete the test's variations** from the CMS (only when an admin has turned that on, after typing a confirmation, and never a variation another live rule still serves), and **archive the flag**.
- **Link existing flag** adopts a flag from a list of the project's CMS flags, e.g. `homepage`.
- **Unlink** removes the link only; nothing changes in FX. Unlinking a running test asks first.

### Experiments view
Every linked experiment on this CMS instance: status (including ended tests and their winner), split, primary metric, start/pause, links to results and the flag, removal of links whose flag is gone, and the CMS flags in FX that no page links to.

## Settings
Five fields, and nothing about the site:
- **Feature Experimentation:** a personal access token with write access to flags and events, and the **SDK key the site uses**. The project and environment are read from that key's datafile, so experiments always land where the site decides.
- **CMS API client:** client ID and secret (CMS → Settings → API Keys). Reading variations needs read access; ending a test needs content write access. **Let "End experiment" delete CMS variations** is off by default.

The site convention (variable names, `control`, reserved names, the URL separator and the preview path) is fixed in `DEFAULT_PROFILE` in `src/shared/profile.ts`, not a setting. For a site with different names, change that one object.

Installs saved before the SDK key setting keep working with their project ID and environment until the settings are saved again, without the datafile checks (live status, audiences by name, per-variation variables).

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The editor's native Variations dropdown can't be extended.** Extensions get a `sidebar`, a `view` or a `property-editor`.
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend maps the version to its variation through the CMS REST API. There is no editor identity, so the backend logs every change it makes (`audit` lines in `ocp app logs`) without a user name.
- **The CMS API can't create variations; only the Variations dropdown can.** So the flow is: create the variation in the dropdown, then add it to the test here.
- **The CMS API can't delete a published version.** Ending a test deletes a variation's other versions; a published one the CMS keeps is listed with the reason, and is no longer served.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.

## Security
- Every action's parameters are checked against allow-lists in `src/backend/lib/validate.ts` before any FX or CMS call, because they end up in API URL paths and JSON Patch pointers. Keys read back from storage are checked again.
- Deleting CMS content is off unless an admin turns it on, needs a typed confirmation, and the backend re-computes and compares the list it is asked to delete.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev            # sidebar + view in a simulated CMS host, invokeFunction against the local backend
```

The live suites in `tests/live/` hit the real FX and CMS APIs. They create throwaway flags (`cms_ext_smoke_*`, `cms_ext_e2e_*`) on scratch routes and archive them afterwards. They never publish or delete CMS content:

```bash
FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… FX_LIVE_SDK_KEY=… \
OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… yarn vitest run tests/live
```

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router, using the `{action, params}` → `{ok, result}` envelope; validates params and logs changes |
| `src/backend/lib/validate.ts` | One parser per action: allow-lists for every parameter |
| `src/backend/lib/experiments.ts` | The actions: create, sync/remove variations, metrics, traffic, audiences, route, start/pause, end, delete, archive, link, list |
| `src/backend/lib/datafile.ts` | The site's datafile: live CMS rules (with per-variation variables), live check, audiences |
| `src/backend/lib/fx.ts` | Flags API v1 and v2 events client |
| `src/backend/lib/cms.ts` | CMS token, per-locale version listing, drafts, publish, delete |
| `src/backend/lib/links.ts` | Content → flag/rule links (and how a test ended) in the OCP KV store, one hash per install |
| `src/backend/lifecycle/Lifecycle.ts` | Validates the settings forms against FX, the datafile and the CMS before saving |
| `src/shared/` | The UI ↔ backend contract, the site profile, key/route rules, traffic splits and the readiness checklist |
| `src/cms-ui-extensions/fx/` | `FxExperiment.sidebar.tsx`, `FxExperiments.view.tsx` and their panels |

## Deploy
The app is CMS-scoped, so it is installed once per CMS instance:

```bash
ocp update                                    # CMS scope needs a recent CLI
ocp app register                              # once
ocp app prepare --bump-dev-version --publish
# then install the published version into the CMS instance (see `ocp directory install --help`)
```

After installing, fill in the Feature Experimentation and CMS sections. The FX token needs write access to flags and events.
