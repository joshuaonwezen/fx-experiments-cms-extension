# Feature Experimentation

Turn a page's CMS variations into a Feature Experimentation A/B test without leaving the editor, and ship the winner when it ends.

- **Feature Experimentation** sidebar: creates the FX flag, one FX variation per CMS variation plus a `control`
  arm for the original page, and an A/B rule with your traffic, audiences and metrics. A checklist says what has to
  be fixed before starting. Start, pause, change the test while it runs, preview each variation, and end it by
  serving the winner from FX or publishing it as the page, then clean up the variations.
- **Experiments** view: every CMS-driven experiment on this instance, with status, winners and results links.

Works with sites that serve CMS variations by FX variation key (CMS variation name = FX variation key, flags marked
with a marker and a route variable). The defaults match optimizely-nextjs-demo; other conventions are set in the
app settings.
