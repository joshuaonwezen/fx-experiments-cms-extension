import {
  Alert,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
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
import {previewUrl, routeProblem, uncoveredPaths, withPaths} from '@shared/experiment';
import {blockers, readiness} from '@shared/readiness';
import type {ActionParams, StatusResult} from '@shared/types';
import {useEffect, useState} from 'react';

import {AudiencePicker} from '../common/AudiencePicker';
import {call, CallError, errorMessage} from '../common/api';
import {MetricPicker} from '../common/MetricPicker';
import {OpenLink} from '../common/OpenLink';
import {formatPercent, StatusBadge} from '../common/StatusBadge';
import {EndedPanel} from './EndedPanel';
import {EndPanel} from './EndPanel';
import {ReadinessChecklist} from './ReadinessChecklist';
import {ResultsSummary} from './ResultsSummary';
import type {PanelProps, StatusAction} from './types';

/** An action the backend wants confirmed, and the flag that confirms it on the retry. */
interface Pending {
  action: StatusAction;
  params: Record<string, unknown>;
  message: string;
  confirmField: 'confirmRunning' | 'confirmConflicts';
}

const CONFIRM_FIELD: Record<string, Pending['confirmField']> = {
  confirm_running: 'confirmRunning',
  experiment_running: 'confirmConflicts',
};

export function LinkedPanel(props: PanelProps) {
  const {context, contentRef, status, events, loadEvents, createEvent, audiences, loadAudiences, onStatus} = props;
  const {link, rule, diff} = status;
  const {profile} = status.settings;
  const savedMetrics = rule?.metrics.map((m) => m.eventId) ?? [];
  const savedAudiences = rule?.audienceIds ?? [];

  const [busy, setBusy] = useState<StatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ending, setEnding] = useState(false);
  const [metricIds, setMetricIds] = useState<number[]>(savedMetrics);
  const [audienceIds, setAudienceIds] = useState<number[]>(savedAudiences);
  const [routeDraft, setRouteDraft] = useState(rule?.route ?? link?.route ?? '');
  const [trafficDraft, setTrafficDraft] = useState(String(rule?.trafficPercent ?? 100));

  const metricsKey = savedMetrics.join(',');
  const audiencesKey = savedAudiences.join(',');
  useEffect(() => setMetricIds(metricsKey ? metricsKey.split(',').map(Number) : []), [metricsKey]);
  useEffect(() => setAudienceIds(audiencesKey ? audiencesKey.split(',').map(Number) : []), [audiencesKey]);
  useEffect(() => setRouteDraft(rule?.route ?? link?.route ?? ''), [rule?.route, link?.route]);
  useEffect(() => setTrafficDraft(String(rule?.trafficPercent ?? 100)), [rule?.trafficPercent]);
  useEffect(() => {
    void loadEvents();
    void loadAudiences();
  }, [loadEvents, loadAudiences]);

  const run = async <A extends StatusAction>(action: A, params: ActionParams[A]) => {
    setBusy(action);
    setError(null);
    try {
      onStatus((await call(context, action, params)) as StatusResult);
      setPending(null);
      setEnding(false);
    } catch (e) {
      const field = e instanceof CallError ? CONFIRM_FIELD[e.code] : undefined;
      if (field) setPending({action, params: params as Record<string, unknown>, message: (e as Error).message, confirmField: field});
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!link) return null;

  const unlinkButton = (
    <Button appearance="subtle" loading={busy === 'unlink'} onClick={() => void run('unlink', {content: contentRef})}>
      Unlink from this page
    </Button>
  );
  const confirmAlert = pending && (
    <Alert intent="warning">
      <Group flexDirection="column" gap="8">
        <Text fontSize="sm">{pending.message}</Text>
        <Group gap="8">
          <Button
            appearance="primary"
            loading={busy === pending.action}
            onClick={() =>
              void run(pending.action, {...pending.params, [pending.confirmField]: true} as ActionParams[typeof pending.action])
            }
            size="sm"
          >
            Continue anyway
          </Button>
          <Button appearance="subtle" onClick={() => setPending(null)} size="sm">Cancel</Button>
        </Group>
      </Group>
    </Alert>
  );

  if (link.conclusion) {
    return <EndedPanel {...props} busy={busy} confirmAlert={confirmAlert} error={error} run={run} unlinkButton={unlinkButton} />;
  }

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

  if (ending) {
    return <EndPanel {...props} busy={busy === 'endExperiment'} error={error} onCancel={() => setEnding(false)} run={run} />;
  }

  const cmsStatus = new Map(status.cmsVariations.map((v) => [v.name, v.status]));
  const editing = status.content.currentVariation;
  const items = readiness({
    basePublished: status.content.basePublished,
    arms: rule.variations.map((v) => v.key).filter((k) => k !== profile.controlKey && k !== 'off'),
    cmsVariations: status.cmsVariations,
    metricCount: rule.metrics.length,
    route: rule.route,
    visitorPaths: status.content.visitorPaths,
    running: status.runningExperiments,
    profile,
  });
  const blocked = blockers(items);
  const clashing = items.some((i) => i.key === 'clash' && !i.ok && status.runningExperiments !== null);
  const missingPaths = uncoveredPaths(rule.route, status.content.visitorPaths);
  const routeError = routeProblem(routeDraft);
  const routeDirty = routeDraft !== rule.route;
  const metricsDirty = metricIds.join(',') !== metricsKey;
  const audiencesDirty = audienceIds.join(',') !== audiencesKey;
  const trafficN = Number(trafficDraft);
  const trafficDirty = trafficN !== rule.trafficPercent;
  const audienceNames = savedAudiences.map((id) => audiences?.find((a) => a.id === id)?.name ?? `audience ${id}`);
  const previewPath = status.content.visitorPaths[0] ?? '';

  return (
    <Group flexDirection="column" gap="12">
      <Group alignItems="center" gap="8" flexWrap="wrap">
        <StatusBadge running={rule.running} status={rule.status} />
        <Text color="fg.secondary" fontSize="xs" truncate>
          {rule.flagKey} · {rule.environmentKey}
        </Text>
      </Group>
      {rule.running && status.liveOnSite === false && (
        <Text color="fg.secondary" fontSize="sm">Going live on the site, usually within a minute.</Text>
      )}
      {rule.running && status.liveOnSite === true && <Text color="fg.success" fontSize="sm">Live on the site.</Text>}
      <Text color="fg.secondary" fontSize="sm">
        {formatPercent(rule.trafficPercent)} of {audienceNames.length ? audienceNames.join(' or ') : 'all visitors'} on{' '}
        <code>{rule.route || 'every page'}</code>
      </Text>

      <ReadinessChecklist
        fixing={busy === 'setRoute'}
        items={items}
        onFixRoute={
          missingPaths.length > 0 && !rule.routePerVariation
            ? () => void run('setRoute', {content: contentRef, route: withPaths(rule.route, status.content.visitorPaths)})
            : undefined
        }
        onlyProblems={rule.running}
      />
      {confirmAlert}
      <Group flexDirection="column" gap="8">
        <Button
          appearance={rule.running ? 'default' : 'primary'}
          disabled={!rule.running && blocked.length > 0}
          loading={busy === 'setRunning'}
          onClick={() =>
            void run('setRunning', {
              content: contentRef,
              running: !rule.running,
              // The checklist above the button is the confirmation.
              confirmConflicts: !rule.running && clashing,
            })
          }
        >
          {rule.running ? 'Pause experiment' : clashing ? 'Start anyway' : 'Start experiment'}
        </Button>
        <OpenLink appearance="subtle" url={rule.flagUrl}>Open flag in FX</OpenLink>
      </Group>

      <Separator />
      {rule.experimentId ? (
        <ResultsSummary
          context={context}
          contentRef={contentRef}
          controlKey={profile.controlKey}
          resultsUrl={rule.resultsUrl}
        />
      ) : (
        <Text color="fg.secondary" fontSize="xs">Results appear here once the experiment has started.</Text>
      )}

      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Variation</TableHeaderCell>
            <TableHeaderCell>Traffic</TableHeaderCell>
            <TableHeaderCell>CMS</TableHeaderCell>
            <TableHeaderCell />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rule.variations.map((v) => {
            const isControl = v.key === profile.controlKey;
            const preview = rule.running && status.liveOnSite
              ? previewUrl(contentRef.publicUrl, previewPath, rule.flagKey, v.key, profile)
              : null;
            return (
              <TableRow key={v.key}>
                <TableCell>
                  {isControl ? 'Original page' : v.key}
                  {editing === v.key && <Text color="fg.accent" fontSize="xs">editing</Text>}
                </TableCell>
                <TableCell>{formatPercent(v.percent)}</TableCell>
                <TableCell>
                  {isControl ? (
                    <Text color="fg.secondary" fontSize="sm">{status.content.basePublished ? 'published' : 'draft'}</Text>
                  ) : cmsStatus.has(v.key) ? (
                    <Text color={cmsStatus.get(v.key) === 'published' ? undefined : 'fg.warning'} fontSize="sm">
                      {cmsStatus.get(v.key)}
                    </Text>
                  ) : v.key === 'off' ? (
                    <Text color="fg.secondary" fontSize="sm">flag off</Text>
                  ) : (
                    <Text color="fg.warning" fontSize="sm">missing</Text>
                  )}
                </TableCell>
                <TableCell>
                  <Group gap="4">
                    {preview && <OpenLink appearance="subtle" url={preview}>Preview</OpenLink>}
                    {!isControl && v.key !== 'off' && (
                      <Button
                        appearance="subtle"
                        aria-label={`Remove ${v.key} from the test`}
                        loading={busy === 'removeVariations'}
                        onClick={() =>
                          void run('removeVariations', {content: contentRef, variations: [v.key], confirmRunning: false})
                        }
                        size="sm"
                      >
                        Remove
                      </Button>
                    )}
                  </Group>
                </TableCell>
              </TableRow>
            );
          })}
          {diff.missingInFx.map((name) => (
            <TableRow key={name}>
              <TableCell>
                {name}
                {editing === name && <Text color="fg.accent" fontSize="xs">editing</Text>}
              </TableCell>
              <TableCell>-</TableCell>
              <TableCell>
                <Text color="fg.warning" fontSize="sm">not in test</Text>
              </TableCell>
              <TableCell />
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {diff.missingInFx.length > 0 && (
        <Button
          loading={busy === 'syncVariations'}
          onClick={() => void run('syncVariations', {content: contentRef, confirmRunning: false})}
        >
          Add {diff.missingInFx.join(', ')} to the experiment
        </Button>
      )}
      {diff.invalid.map((i) => (
        <Text color="fg.warning" fontSize="xs" key={i.name}>
          {i.name}: {i.reason}
        </Text>
      ))}

      <Disclosure>
        <DisclosureTrigger>Settings: traffic, audience, metrics, URLs</DisclosureTrigger>
        <DisclosureContent>
          <Group flexDirection="column" gap="12" pt="8">
            <Field error={trafficN >= 1 && trafficN <= 100 ? null : 'Between 1 and 100.'} label="Traffic (%)">
              <Input max={100} min={1} onChange={(e) => setTrafficDraft(e.target.value)} type="number" value={trafficDraft} />
            </Field>
            {trafficDirty && trafficN >= 1 && trafficN <= 100 && (
              <Button
                loading={busy === 'setTraffic'}
                onClick={() => void run('setTraffic', {content: contentRef, trafficPercent: trafficN})}
                size="sm"
              >
                Save traffic
              </Button>
            )}

            <Group flexDirection="column" gap="4">
              <Text fontSize="sm" fontWeight="500">Audience</Text>
              <AudiencePicker audiences={audiences} onChange={setAudienceIds} selected={audienceIds} />
              {audiencesDirty && (
                <Button
                  loading={busy === 'setAudiences'}
                  onClick={() => void run('setAudiences', {content: contentRef, audienceIds})}
                  size="sm"
                >
                  Save audience
                </Button>
              )}
            </Group>

            <Group flexDirection="column" gap="4">
              <Text fontSize="sm" fontWeight="500">Metrics</Text>
              <MetricPicker events={events} onChange={setMetricIds} onCreateEvent={createEvent} selected={metricIds} />
              {metricsDirty && (
                <Button
                  loading={busy === 'setMetrics'}
                  onClick={() => void run('setMetrics', {content: contentRef, eventIds: metricIds})}
                  size="sm"
                >
                  Save metrics
                </Button>
              )}
            </Group>

            <Field
              description={
                rule.routePerVariation
                  ? `This flag sets ${profile.routeVariable} per variation; change it in FX.`
                  : `The URLs the test runs on (the flag's ${profile.routeVariable}).`
              }
              error={routeDirty ? routeError : null}
              label="Route"
            >
              <Input disabled={rule.routePerVariation} onChange={(e) => setRouteDraft(e.target.value)} value={routeDraft} />
            </Field>
            {routeDirty && (
              <Button
                disabled={Boolean(routeError)}
                loading={busy === 'setRoute'}
                onClick={() => void run('setRoute', {content: contentRef, route: routeDraft})}
                size="sm"
              >
                Save route
              </Button>
            )}
          </Group>
        </DisclosureContent>
      </Disclosure>

      {error && <Alert intent="danger">{error}</Alert>}
      <Separator />
      <Button onClick={() => setEnding(true)}>End experiment</Button>
      <Text color="fg.secondary" fontSize="xs">
        Unlinking only removes the connection here. The flag and its results stay in FX.
      </Text>
      {unlinkButton}
    </Group>
  );
}
