# Feature Experimentation

## Setup

1. Install the app on the CMS instance.
2. In the app settings:
   - **Feature Experimentation**: a personal access token with write access, the project ID the site's
     SDK key belongs to, the environment for new rules (default `production`) and, optionally, default
     audience IDs.
   - **CMS API client**: a client ID and secret from CMS → Settings → API Keys. The extension reads the
     open item's versions with it to find its variations.
3. Open a page that has variations. The **Experiment** panel appears in the editor sidebar.

## How it maps to the site

- The CMS variation name must equal the FX variation key exactly. Names that aren't valid FX keys
  are flagged so you can rename them.
- New flags get `cms_flag = true` and `cms_route = <route>` as variable defaults, so the site's
  middleware routes visitors into the variation on that path.
- `control` serves the original page and still records an FX impression, so the baseline is measured.
