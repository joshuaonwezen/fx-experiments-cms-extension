# Feature Experimentation

Turn the CMS variations of a page into a Feature Experimentation (FX) A/B test from the editor, and ship the
winner when it ends. Walkthrough: [Feature Experimentation extension](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#fx-experiments).

## Setup

1. Install the app on the CMS instance. Each CMS instance gets its own install.
2. In the app settings:
   - **Feature Experimentation**: a personal access token (FX: Profile > API Access) with write access to the
     project's flags and events, and the SDK key your site decides with (FX: Settings > Environments). The project
     and environment are read from the SDK key.
   - **CMS API client**: a client ID and secret (CMS: Settings > API Keys). Ending a test publishes and deletes
     content, so give the key content write access. Deleting variations stays off until you turn it on.
3. Open a page that has variations. The **Feature Experimentation** panel is on the editor's right-hand rail, and
   **Experiments** is under Extensions in the navigation rail.

## Running a test

1. Pick the variations, the metric, and who takes part.
2. Check the list under the form: the page and its variations must be published before the test can start.
3. Start it. The panel says when the test is live on the site.
4. When the results are in, choose **End experiment**, pick the winner, and either serve it from FX or make it the
   page in the CMS. Then delete the variations you no longer need.

## What your site needs

Your site decides which CMS variation to show from the FX decision. It has to:

- decide with the same SDK key as the app settings;
- apply a flag to CMS content only when its boolean `cms_flag` variable is `true` and its `cms_route` variable
  covers the request path (a comma-separated list of exact paths and `/*` prefixes; empty means every page);
- serve the CMS variation whose name equals the FX variation key exactly, and the original page for `control`;
- send the FX impression where the variation renders, `control` included;
- apply targeted deliveries the same way as A/B rules, since ending a test from FX uses one.

How a site does this: [the site side](https://opti.joshuaonwezen.dev/demo/feature-experimentation).

## Help

- Using the app on another CMS instance: [reuse](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#reuse).
- Something not working: [troubleshooting](https://opti.joshuaonwezen.dev/demo/cms-ui-extensions#troubleshooting).
