import {
  Alert,
  AxiomProvider,
  Badge,
  Box,
  Button,
  Group,
  Heading,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {CmsFlagOption, ExperimentLink, ExperimentsOverview} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {formatPercent, StatusBadge} from '../common/StatusBadge';

const rowKey = (link: ExperimentLink) => `${link.contentKey}:${link.locale}`;

function endedText(link: ExperimentLink): string {
  const ended = link.conclusion!;
  if (!ended.winner) return 'No winner';
  if (!ended.shipVia) return 'Original page won';
  if (ended.shipVia === 'fx') return `${ended.winner} won · served by FX`;
  return ended.promotion === 'published' ? `${ended.winner} won · now the page` : `${ended.winner} won · awaiting approval`;
}

function FxExperiments({context}: {context: ExtensionContext}) {
  const [overview, setOverview] = useState<ExperimentsOverview | null>(null);
  const [unlinked, setUnlinked] = useState<CmsFlagOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await call(context, 'listExperiments', {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // Secondary: flags FX has that no page links to.
    call(context, 'listCmsFlags', {}).then(
      (flags) => setUnlinked(flags.filter((f) => !f.linked)),
      () => setUnlinked(null),
    );
  }, [context]);

  useEffect(() => {
    void context.extension.setReady();
    void load();
  }, [context, load]);

  const rowAction = async (link: ExperimentLink, action: () => Promise<unknown>) => {
    setBusyRow(rowKey(link));
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(`${link.displayName}: ${errorMessage(e)}`);
    } finally {
      setBusyRow(null);
    }
  };

  const setRunning = (link: ExperimentLink, running: boolean) =>
    rowAction(link, () => call(context, 'setRunning', {content: {key: link.contentKey, locale: link.locale}, running}));
  const forget = (link: ExperimentLink) =>
    rowAction(link, async () => setOverview(await call(context, 'forgetLink', {contentKey: link.contentKey, locale: link.locale})));

  const rows = overview?.rows ?? null;
  const otherProject = overview?.otherProject ?? [];
  const running = rows?.filter((r) => r.rule?.running && !r.link.conclusion).length ?? 0;

  // Links to experiments in another FX project (the SDK key changed since): not this
  // project's experiments, so they're hidden and can be removed in one go.
  const forgetOtherProject = async () => {
    setLoading(true);
    setError(null);
    try {
      let next: ExperimentsOverview | null = null;
      for (const link of otherProject) {
        next = await call(context, 'forgetLink', {contentKey: link.contentKey, locale: link.locale});
      }
      if (next) setOverview(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box p="24">
      <Group flexDirection="column" gap="16">
        <Group alignItems="center" justifyContent="space-between">
          <Group flexDirection="column" gap="4">
            <Heading level="2">Experiments</Heading>
            <Text color="fg.secondary">
              Pages whose CMS variations are in a Feature Experimentation A/B test
              {rows ? ` · ${rows.length} linked, ${running} running` : ''}.
            </Text>
            {overview && (
              <Text color="fg.tertiary" fontSize="xs">
                Feature Experimentation project {overview.projectId} · {overview.environmentKey}
              </Text>
            )}
          </Group>
          <Button loading={loading} onClick={() => void load()}>Refresh</Button>
        </Group>

        {error && <Alert intent="danger">{error}</Alert>}
        {otherProject.length > 0 && (
          <Alert intent="information">
            <Group alignItems="center" gap="8" justifyContent="space-between">
              <Text fontSize="sm">
                {otherProject.length === 1 ? '1 page is' : `${otherProject.length} pages are`} still linked to an
                experiment in another Feature Experimentation project, so {otherProject.length === 1 ? 'it is' : 'they are'}{' '}
                hidden here.
              </Text>
              <Button loading={loading} onClick={() => void forgetOtherProject()} size="sm">
                Remove {otherProject.length === 1 ? 'it' : 'them'}
              </Button>
            </Group>
          </Alert>
        )}
        {!rows && !error && <Spinner />}
        {rows && rows.length === 0 && (
          <Alert intent="information">
            <Text fontSize="sm">
              No experiments yet. Open a page that has variations and use the Feature Experimentation panel in the editor
              sidebar to create one.
            </Text>
          </Alert>
        )}

        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell>Route</TableHeaderCell>
                <TableHeaderCell>Flag</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Split</TableHeaderCell>
                <TableHeaderCell>Primary metric</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({link, rule, error: rowError}) => (
                <TableRow key={rowKey(link)}>
                  <TableCell>
                    <Text fontSize="sm">{link.displayName}</Text>
                    <Text color="fg.tertiary" fontSize="xs">{link.locale}</Text>
                  </TableCell>
                  <TableCell>
                    <code>{rule?.route || link.route || '-'}</code>
                  </TableCell>
                  <TableCell>
                    <code>{link.flagKey}</code>
                    <Text color="fg.tertiary" fontSize="xs">{link.environmentKey}</Text>
                  </TableCell>
                  <TableCell>
                    {link.conclusion ? (
                      <Group flexDirection="column" gap="4">
                        <Badge intent="information" variant="subtle">ended</Badge>
                        <Text color="fg.secondary" fontSize="xs">{endedText(link)}</Text>
                      </Group>
                    ) : rule ? (
                      <StatusBadge running={rule.running} status={rule.status} />
                    ) : (
                      <Text color="fg.error" fontSize="sm">{rowError}</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    {rule && (
                      <Text fontSize="sm">
                        {rule.variations.map((v) => `${v.key} ${formatPercent(v.percent)}`).join(' · ')}
                        {rule.trafficPercent < 100 && (
                          <Text asChild color="fg.secondary" fontSize="xs">
                            <span> ({formatPercent(rule.trafficPercent)} traffic)</span>
                          </Text>
                        )}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Text fontSize="sm">{rule?.metrics[0]?.title ?? '-'}</Text>
                    {rule && rule.metrics.length > 1 && (
                      <Text color="fg.tertiary" fontSize="xs">+{rule.metrics.length - 1} more</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Group gap="8">
                      {rule && !link.conclusion && (
                        <Button
                          loading={busyRow === rowKey(link)}
                          onClick={() => void setRunning(link, !rule.running)}
                          size="sm"
                        >
                          {rule.running ? 'Pause' : 'Start'}
                        </Button>
                      )}
                      {rule?.resultsUrl && <OpenLink url={rule.resultsUrl}>Results</OpenLink>}
                      {rule && <OpenLink appearance="subtle" url={rule.flagUrl}>Flag</OpenLink>}
                      {!rule && rowError && (
                        <Button appearance="subtle" loading={busyRow === rowKey(link)} onClick={() => void forget(link)} size="sm">
                          Remove
                        </Button>
                      )}
                    </Group>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {unlinked && unlinked.length > 0 && (
          <Group flexDirection="column" gap="8">
            <Heading level="4">CMS flags no page links to</Heading>
            <Text color="fg.secondary" fontSize="sm">
              These flags can serve CMS variations but aren&apos;t linked to a page here. Link one from a page&apos;s
              Feature Experimentation panel to manage it from the editor.
            </Text>
            <Text fontSize="sm">{unlinked.map((f) => f.flagKey).join(', ')}</Text>
          </Group>
        )}
      </Group>
    </Box>
  );
}

register((context) => (
  <AxiomProvider>
    <FxExperiments context={context} />
  </AxiomProvider>
));
