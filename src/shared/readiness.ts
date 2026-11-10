import {reservedPrefixOf, routeCovers} from './experiment';
import type {SiteProfile} from './profile';
import type {CmsVariation, RunningExperiment} from './types';

// One list of what has to be true before an experiment starts. The sidebar shows it as a
// checklist; the backend refuses to start while a blocking item fails, so the two agree.

export interface ReadinessItem {
  key: 'base' | 'variations' | 'metric' | 'route' | 'clash' | 'reserved';
  ok: boolean;
  /** A failing blocking item stops Start; the others are warnings. */
  blocking: boolean;
  text: string;
}

export interface ReadinessInput {
  basePublished: boolean;
  /** The challenger arms (control excluded). */
  arms: string[];
  cmsVariations: CmsVariation[];
  metricCount: number;
  route: string;
  visitorPaths: string[];
  /** Live rules on other CMS flags; null when FX couldn't be checked. */
  running: RunningExperiment[] | null;
  profile: SiteProfile;
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

export function readiness(input: ReadinessInput): ReadinessItem[] {
  const {profile} = input;
  const status = new Map(input.cmsVariations.map((v) => [v.name, v.status]));
  const missing = input.arms.filter((a) => !status.has(a));
  const unpublished = input.arms.filter((a) => status.has(a) && status.get(a) !== 'published');
  const uncovered = input.visitorPaths.filter((p) => !routeCovers(input.route, p));
  const clashes = (input.running ?? []).filter((r) => input.visitorPaths.some((p) => routeCovers(r.route, p)));
  const reserved = input.cmsVariations.map((v) => v.name).filter((n) => reservedPrefixOf(n, profile));

  const variationsText =
    missing.length > 0
      ? `Create ${quote(missing)} in the editor's Variations menu, or remove ${missing.length === 1 ? 'it' : 'them'} from the test.`
      : unpublished.length > 0
        ? `Publish ${quote(unpublished)}. Until then, visitors in ${unpublished.length === 1 ? 'that group' : 'those groups'} see the original page and aren't counted.`
        : 'Every variation in the test is published.';

  return [
    {
      key: 'base',
      ok: input.basePublished,
      blocking: true,
      text: input.basePublished ? 'The original page is published.' : 'Publish the original page first.',
    },
    {key: 'variations', ok: missing.length === 0 && unpublished.length === 0, blocking: true, text: variationsText},
    {
      key: 'metric',
      ok: input.metricCount > 0,
      blocking: false,
      text: input.metricCount > 0 ? 'A metric is set.' : 'Pick a metric, or the results page will have nothing to show.',
    },
    {
      key: 'route',
      ok: uncovered.length === 0,
      blocking: false,
      text:
        uncovered.length === 0
          ? 'The test runs on every URL of this page.'
          : `Visitors on ${uncovered.join(', ')} won't enter the test. Add ${uncovered.length === 1 ? 'it' : 'them'} to the route.`,
    },
    {
      key: 'clash',
      ok: input.running !== null && clashes.length === 0,
      blocking: false,
      text:
        clashes.length === 0
          ? input.running === null
            ? "Couldn't check FX for other tests on this page."
            : 'Nothing else changes this page for visitors.'
          : `Also changing this page: ${clashes.map((c) => `${c.flagKey} (${c.kind === 'delivery' ? 'personalization' : 'experiment'})`).join(', ')}. Visitors can get both, which muddies the results.`,
    },
    {
      key: 'reserved',
      ok: reserved.length === 0,
      blocking: false,
      text:
        reserved.length === 0
          ? 'No variations from other tools on this page.'
          : `This page also has ${quote(reserved)}, run by another tool. It can take over visitors in the original-page group.`,
    },
  ];
}

/** The blocking items that fail, as one sentence each. */
export function blockers(items: ReadinessItem[]): string[] {
  return items.filter((i) => i.blocking && !i.ok).map((i) => i.text);
}
