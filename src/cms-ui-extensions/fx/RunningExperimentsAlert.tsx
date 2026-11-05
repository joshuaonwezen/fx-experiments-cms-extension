import {Alert, Group, Text} from '@optiaxiom/react';
import {routesOverlap} from '@shared/experiment';
import type {RunningExperiment} from '@shared/types';

import {OpenLink} from '../common/OpenLink';

/** The running experiments (on other flags) whose cms_route overlaps `route`. */
export function clashesFor(running: RunningExperiment[] | null, route: string): RunningExperiment[] {
  return (running ?? []).filter((e) => routesOverlap(e.route, route));
}

/**
 * Warns that another CMS experiment runs on this page's route. `running` is null when
 * FX couldn't be checked; `bothRunning` when this page's own experiment is live too.
 */
export function RunningExperimentsAlert({
  running,
  clashes,
  bothRunning,
}: {
  running: RunningExperiment[] | null;
  clashes: RunningExperiment[];
  bothRunning: boolean;
}) {
  if (running === null) {
    return (
      <Text color="fg.secondary" fontSize="xs">
        Couldn&apos;t check FX for other experiments running on this route.
      </Text>
    );
  }
  if (clashes.length === 0) return null;

  return (
    <Alert intent="warning">
      <Group flexDirection="column" gap="8">
        <Text fontSize="sm">
          {bothRunning
            ? 'Also running on this route. Visitors land in both experiments, but the page shows one variation, so both results are muddied.'
            : 'Already running on this route. Starting this one too puts visitors in both, but the page shows one variation, so both results get muddied. Pause the other one first.'}
        </Text>
        {clashes.map((e) => (
          <Group alignItems="center" gap="8" justifyContent="space-between" key={`${e.flagKey}/${e.ruleKey}`}>
            <Text fontSize="sm" truncate>
              <code>{e.flagKey}</code> / {e.ruleName} · <code>{e.route || 'every route'}</code>
            </Text>
            <OpenLink appearance="subtle" url={e.flagUrl}>Open in FX</OpenLink>
          </Group>
        ))}
      </Group>
    </Alert>
  );
}
