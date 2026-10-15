import {
  Alert,
  Button,
  Field,
  Group,
  Input,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@optiaxiom/react';
import {CONTROL_VARIATION_KEY} from '@shared/constants';
import {routeProblem} from '@shared/experiment';
import type {ActionName, ActionParams, StatusResult} from '@shared/types';
import {useEffect, useState} from 'react';

import {call, CallError, errorMessage} from '../common/api';
import {MetricPicker} from '../common/MetricPicker';
import {OpenLink} from '../common/OpenLink';
import {formatPercent, StatusBadge} from '../common/StatusBadge';
import type {PanelProps} from './types';

type StatusAction = Exclude<ActionName, 'listEvents' | 'createEvent' | 'listExperiments'>;

export function LinkedPanel(props: PanelProps) {
  const {context, contentRef, status, events, loadEvents, createEvent, onStatus} = props;
  const {link, rule, diff} = status;
  const savedMetrics = rule?.metrics.map((m) => m.eventId) ?? [];

  const [busy, setBusy] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [metricIds, setMetricIds] = useState<number[]>(savedMetrics);
  const [routeDraft, setRouteDraft] = useState(link?.route ?? '');

  const metricsKey = savedMetrics.join(',');
  useEffect(() => setMetricIds(metricsKey ? metricsKey.split(',').map(Number) : []), [metricsKey]);
  useEffect(() => setRouteDraft(rule?.route ?? link?.route ?? ''), [rule?.route, link?.route]);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const run = async <A extends StatusAction>(action: A, params: ActionParams[A]) => {
    setBusy(action);
    setError(null);
    try {
      onStatus((await call(context, action, params)) as StatusResult);
      setConfirmSync(false);
    } catch (e) {
      if (e instanceof CallError && e.code === 'confirm_running') setConfirmSync(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!link) return null;

  const unlinkButton = (
    <Button
      appearance="subtle"
      loading={busy === 'unlink'}
      onClick={() => void run('unlink', {content: contentRef})}
    >
      Unlink from this page
    </Button>
  );

  if (!rule) {
    return (
      <Group flexDirection="column" gap="8">
        <Alert intent="danger">{status.ruleError ?? 'The linked FX rule is unavailable.'}</Alert>
        <Text color="fg.secondary" fontSize="sm">
          Linked to <code>{link.flagKey}</code> / <code>{link.ruleKey}</code> ({link.environmentKey}).
        </Text>
        {error && <Alert intent="danger">{error}</Alert>}
        {unlinkButton}
      </Group>
    );
  }

  const cmsStatus = new Map(status.cmsVariations.map((v) => [v.name, v.status]));
  const editing = status.content.currentVariation;
  const routeError = routeProblem(routeDraft);
  const metricsDirty = metricIds.join(',') !== metricsKey;

  return (
    <Group flexDirection="column" gap="12">
      <Group alignItems="center" gap="8" flexWrap="wrap">
        <StatusBadge running={rule.running} status={rule.status} />
        <Text fontSize="sm" truncate>
          <code>{rule.flagKey}</code> · {rule.environmentKey}
        </Text>
      </Group>
      <Text color="fg.secondary" fontSize="sm">
        {formatPercent(rule.trafficPercent)} of {status.settings.audienceIds.length ? 'the audience' : 'visitors'} on{' '}
        <code>{rule.route || 'every route'}</code>
      </Text>

      <Group flexDirection="column" gap="8">
        <Button
          appearance={rule.running ? 'default' : 'primary'}
          loading={busy === 'setRunning'}
          onClick={() => void run('setRunning', {content: contentRef, running: !rule.running})}
        >
          {rule.running ? 'Pause experiment' : 'Start experiment'}
        </Button>
        {rule.resultsUrl ? (
          <OpenLink appearance="default" url={rule.resultsUrl}>View results</OpenLink>
        ) : (
          <Text color="fg.secondary" fontSize="xs">FX creates the results page the first time the experiment starts.</Text>
        )}
        <OpenLink appearance="subtle" url={rule.flagUrl}>Open flag in FX</OpenLink>
      </Group>

      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Variation</TableHeaderCell>
            <TableHeaderCell>Traffic</TableHeaderCell>
            <TableHeaderCell>CMS</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rule.variations.map((v) => (
            <TableRow key={v.key}>
              <TableCell>
                {v.key}
                {editing === v.key && <Text color="fg.accent" fontSize="xs">editing</Text>}
              </TableCell>
              <TableCell>{formatPercent(v.percent)}</TableCell>
              <TableCell>
                {v.key === CONTROL_VARIATION_KEY ? (
                  <Text color="fg.secondary" fontSize="sm">original page</Text>
                ) : cmsStatus.has(v.key) ? (
                  <Text fontSize="sm">{cmsStatus.get(v.key)}</Text>
                ) : v.key === 'off' ? (
                  <Text color="fg.secondary" fontSize="sm">flag off</Text>
                ) : (
                  <Text color="fg.warning" fontSize="sm">missing</Text>
                )}
              </TableCell>
            </TableRow>
          ))}
          {diff.missingInFx.map((name) => (
            <TableRow key={name}>
              <TableCell>
                {name}
                {editing === name && <Text color="fg.accent" fontSize="xs">editing</Text>}
              </TableCell>
              <TableCell>—</TableCell>
              <TableCell>
                <Text color="fg.warning" fontSize="sm">not in test</Text>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {diff.missingInFx.length > 0 && !confirmSync && (
        <Button
          loading={busy === 'syncVariations'}
          onClick={() => void run('syncVariations', {content: contentRef, confirmRunning: false})}
        >
          Add {diff.missingInFx.join(', ')} to the experiment
        </Button>
      )}
      {confirmSync && (
        <Alert intent="warning">
          <Group flexDirection="column" gap="8">
            <Text fontSize="sm">
              The experiment is running. Adding variations re-splits traffic evenly, so some visitors will switch
              variation and early results get noisier.
            </Text>
            <Group gap="8">
              <Button
                appearance="primary"
                loading={busy === 'syncVariations'}
                onClick={() => void run('syncVariations', {content: contentRef, confirmRunning: true})}
                size="sm"
              >
                Add anyway
              </Button>
              <Button appearance="subtle" onClick={() => setConfirmSync(false)} size="sm">Cancel</Button>
            </Group>
          </Group>
        </Alert>
      )}
      {diff.missingInCms.length > 0 && (
        <Alert intent="warning">
          Create {diff.missingInCms.length === 1 ? 'a variation' : 'variations'} named exactly{' '}
          {diff.missingInCms.map((n) => `"${n}"`).join(', ')} in the Variations dropdown. Until then, visitors bucketed
          there see the original page.
        </Alert>
      )}
      {diff.invalid.map((i) => (
        <Text color="fg.warning" fontSize="xs" key={i.name}>
          {i.name}: {i.reason}
        </Text>
      ))}

      <Separator />
      <Field
        description="Path(s) the site serves this experiment on (the flag's cms_route)."
        error={routeDraft !== (rule.route || link.route) ? routeError : null}
        label="Route"
      >
        <Input onChange={(e) => setRouteDraft(e.target.value)} value={routeDraft} />
      </Field>
      {routeDraft !== (rule.route || link.route) && (
        <Button
          disabled={Boolean(routeError)}
          loading={busy === 'setRoute'}
          onClick={() => void run('setRoute', {content: contentRef, route: routeDraft})}
          size="sm"
        >
          Save route
        </Button>
      )}

      <Group flexDirection="column" gap="4">
        <Text fontSize="sm" fontWeight="500">Metrics</Text>
        <MetricPicker events={events} onChange={setMetricIds} onCreateEvent={createEvent} selected={metricIds} />
        {metricsDirty && (
          <Button
            appearance="primary"
            loading={busy === 'setMetrics'}
            onClick={() => void run('setMetrics', {content: contentRef, eventIds: metricIds})}
            size="sm"
          >
            Save metrics
          </Button>
        )}
      </Group>

      {error && <Alert intent="danger">{error}</Alert>}
      <Separator />
      <Text color="fg.secondary" fontSize="xs">
        Unlinking only removes the connection here. The flag and its results stay in FX.
      </Text>
      {unlinkButton}
    </Group>
  );
}
