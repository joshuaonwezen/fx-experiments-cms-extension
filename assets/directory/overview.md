# Feature Experimentation

Turn a page's CMS variations into a Feature Experimentation A/B test without leaving the editor.

- **Feature Experimentation** sidebar: creates the FX flag, one FX variation per CMS variation plus a `control`
  arm for the original page, and an A/B rule with your traffic split, audience and metrics. Start,
  pause, add variations later, and jump straight to the results page.
- **Experiments** view: every CMS-driven experiment on this instance, with status and results links.

Built for sites that serve CMS variations by FX variation key (CMS variation name = FX variation key,
flags marked with `cms_flag` / `cms_route` variables), such as optimizely-nextjs-demo.
