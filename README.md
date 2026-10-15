# FX Experiments: CMS UI extension

An Optimizely CMS (SaaS) UI extension, built as a CMS-scoped OCP app, that turns a page's CMS variations into a Feature Experimentation A/B test from inside the editor.

It is built for `optimizely-nextjs-demo`, which serves CMS variations by FX decision. The convention it relies on:
- the CMS variation name equals the FX variation key;
- a flag drives CMS content when it has the `cms_flag` and `cms_route` variables.

## What it does

### Experiment sidebar (per page)
- Reads the open item's variations through the CMS REST API, and shows which variation you are editing.
- **Create experiment** sets up the whole test in FX:
  - **Flag:** `cms_flag = true` and `cms_route = <route>` are set as variable *defaults*, so a variation added later in the FX UI inherits them.
  - **Variations:** one FX variation per chosen CMS variation, plus `control` for the original page.
  - **A/B rule:** an even split, a traffic %, the default audience from settings, and the metrics you pick.
  - It can start the experiment immediately.
- **Once linked:**
  - Start / Pause.
  - **View results**, which opens the rule's `fetch_results_ui_url`. FX only creates the results page the first time the rule starts.
  - Open flag in FX.
  - A CMS ↔ FX variation table, with a one-click **Add to experiment** for new CMS variations. On a running experiment it asks for confirmation first, because adding variations re-splits traffic.
  - Hints for FX arms that have no CMS variation yet.
  - Edit the route.
  - Edit metrics: the first one is primary, and you can create a new custom event inline.
- **Link existing flag** adopts a flag you already have, e.g. `homepage`.
- **Unlink** removes the link only; nothing changes in FX.

### Experiments view
A full-page list of every linked experiment on this CMS instance: status, split, primary metric, and links to its results and flag.

## Platform constraints (CMS UI extensions beta, SDK 1.1.0)
- **The editor's native Variations dropdown can't be extended.** Extensions get a `sidebar`, a `view` or a `property-editor`.
- **The extension context is only `{key, version, locale, publicUrl}`.** The backend maps the version to its variation through the CMS REST API.
- **The CMS API can't create variations; only the Variations dropdown can.** So the flow is: create the variation in the dropdown, then mirror it to FX here.
- **Extensions get no CMS token.** The app stores a CMS API client in its settings.

## The site side
`control` serves the base page. The catch-all in optimizely-nextjs-demo fires the FX impression for a `control` decision, so the baseline arm is counted (see `CONTROL_VARIATION_KEY` in `src/lib/optimizely/variationPath.ts`). Don't name a CMS variation `control`, `off` or `on`.

## Develop

```bash
yarn install
yarn validate      # lint + typecheck + unit tests + build + ocp-app-sdk validate
ocp dev            # sidebar + view in a simulated CMS host, invokeFunction against the local backend
```

The live suites in `tests/live/` hit the real FX and CMS APIs. They create throwaway flags (`cms_ext_smoke_*`, `cms_ext_e2e_*`) and archive them afterwards:

```bash
FX_LIVE=1 OPTIMIZELY_FX_API_TOKEN=… OPTIMIZELY_FX_PROJECT_ID=… \
OPTIMIZELY_CMS_CLIENT_ID=… OPTIMIZELY_CMS_CLIENT_SECRET=… yarn vitest run tests/live
```

## Layout

| Path | What |
|---|---|
| `src/backend/functions/CmsUiExtension.ts` | Action router, using the `{action, params}` → `{ok, result}` envelope |
| `src/backend/lib/experiments.ts` | The actions: create, sync, metrics, route, start/pause, link, list |
| `src/backend/lib/fx.ts` | Flags API v1 and v2 events client |
| `src/backend/lib/cms.ts` | CMS token and per-locale version listing |
| `src/backend/lib/links.ts` | Content → flag/rule links in the OCP KV store, one hash per install |
| `src/backend/lifecycle/Lifecycle.ts` | Validates the settings forms against FX and the CMS before saving |
| `src/shared/` | The UI ↔ backend contract, key/route rules and the traffic split |
| `src/cms-ui-extensions/fx/` | `FxExperiment.sidebar.tsx`, `FxExperiments.view.tsx` and their panels |

## Deploy
The app is CMS-scoped, so it is installed once per CMS instance:

```bash
ocp update                                    # CMS scope needs a recent CLI
ocp app register                              # once
ocp app prepare --bump-dev-version --publish
# then install the published version into the CMS instance (see `ocp directory install --help`)
```

After installing, fill in both settings sections. The FX token needs write access to flags and events.
