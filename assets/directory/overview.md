# Feature Experimentation

Turn a page's CMS variations into a Feature Experimentation A/B test without leaving the editor, and ship the winner when it ends.

- **Feature Experimentation** sidebar: creates the FX flag, one FX variation per CMS variation plus a `control`
  arm for the original page, and an A/B rule with your traffic, audiences and metrics. A checklist says what has to
  be fixed before starting. Start, pause, change the test while it runs, preview each variation, and end it by
  serving the winner from FX or publishing it as the page, then clean up the variations.
- **Experiments** view: every CMS-driven experiment on this instance, with status, winners and results links.

Works with sites that serve CMS variations by FX decision: the CMS variation name equals the FX variation key, and
flags that drive CMS content carry the `cms_flag` and `cms_route` variables. Setup is credentials only: an FX token,
the site's SDK key and a CMS API client.
