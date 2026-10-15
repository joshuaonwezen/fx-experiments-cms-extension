import {
  Alert,
  AxiomProvider,
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
import type {ExperimentRow} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {formatPercent, StatusBadge} from '../common/StatusBadge';

function FxExperiments({context}: {context: ExtensionContext}) {
  const [rows, setRows] = useState<ExperimentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await call(context, 'listExperiments', {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void context.extension.setReady();
    void load();
  }, [context, load]);

  const running = rows?.filter((r) => r.rule?.running).length ?? 0;

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
          </Group>
          <Button loading={loading} onClick={() => void load()}>Refresh</Button>
        </Group>

        {error && <Alert intent="danger">{error}</Alert>}
        {!rows && !error && <Spinner />}
        {rows && rows.length === 0 && (
          <Alert intent="information">
            No experiments yet. Open a page that has variations and use the Experiment panel in the editor
            sidebar to create one.
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
                <TableRow key={`${link.contentKey}:${link.locale}`}>
                  <TableCell>
                    <Text fontSize="sm">{link.displayName}</Text>
                    <Text color="fg.tertiary" fontSize="xs">{link.locale}</Text>
                  </TableCell>
                  <TableCell>
                    <code>{rule?.route || link.route || '—'}</code>
                  </TableCell>
                  <TableCell>
                    <code>{link.flagKey}</code>
                    <Text color="fg.tertiary" fontSize="xs">{link.environmentKey}</Text>
                  </TableCell>
                  <TableCell>
                    {rule ? (
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
                    <Text fontSize="sm">{rule?.metrics[0]?.title ?? '—'}</Text>
                    {rule && rule.metrics.length > 1 && (
                      <Text color="fg.tertiary" fontSize="xs">+{rule.metrics.length - 1} more</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    {rule && (
                      <Group gap="8">
                        {rule.resultsUrl && <OpenLink url={rule.resultsUrl}>Results</OpenLink>}
                        <OpenLink appearance="subtle" url={rule.flagUrl}>Flag</OpenLink>
                      </Group>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
