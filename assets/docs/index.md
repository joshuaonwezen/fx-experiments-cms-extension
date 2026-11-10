# Feature Experimentation

## Setup

1. Install the app on the CMS instance.
2. In the app settings:
   - **Feature Experimentation**: a personal access token with write access, and the SDK key your site uses.
     The project and environment are read from the SDK key. Optionally, audiences to preselect.
   - **CMS API client**: a client ID and secret from CMS → Settings → API Keys. Ending a test publishes and
     deletes content, so use a key with content write access. Deleting variations stays off until you turn it on.
   - **Site convention**: only if your site differs from optimizely-nextjs-demo (variable names, the original-page
     variation key, reserved names, URL style).
3. Open a page that has variations. The **Feature Experimentation** panel appears in the editor sidebar.

## Running a test

1. Pick the variations, the metric, and who takes part.
2. Check the list under the form: the page and its variations must be published before the test can start.
3. Start it. The panel says when the test is live on the site.
4. When the results are in, choose **End experiment**, pick the winner, and either serve it from FX or make it the
   page in the CMS. Then delete the variations you no longer need.

## How it maps to the site

- The CMS variation name must equal the FX variation key exactly. Names that aren't valid FX keys are flagged so
  you can rename them.
- New flags get the marker and route variables as defaults, so the site's middleware routes visitors into the
  variation on those URLs.
- `control` serves the original page and still records an FX impression, so the baseline is measured.
