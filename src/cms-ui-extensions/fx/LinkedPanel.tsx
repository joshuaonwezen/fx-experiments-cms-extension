import {
  Alert,
  Button,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Field,
  Group,
  Input,
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
import {Chip, Code, type ChipState} from '../common/ui';
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

/** A variation's state in the CMS, as a chip: what visitors in that arm actually get. */
function cmsChip(status: string | undefined): {state: ChipState; label: string} {
  if (status === 'published') return {state: 'good', label: 'Published'};
  if (status === 'draft') return {state: 'warn', label: 'Draft'};
  if (status === undefined) return {state: 'bad', label: 'Missing in the CMS'};
  return {state: 'warn', label: status.charAt(0).toUpperCase() + status.slice(1)};
}

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
    <Button appearance="subtle" loading={busy === 'unlink'} onClick={() => void run('unlink', {content: contentRef})} size="sm">
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
          Linked to <Code>{link.flagKey}</Code> / <Code>{link.ruleKey}</Code> ({link.environmentKey}).
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

  const problems = items.filter((i) => !i.ok);

  return (
    <Group flexDirection="column" gap="12">
      <div className="ui-card">
        <div className="ui-card-title">
          <StatusBadge running={rule.running} status={rule.status} />
          {rule.running && status.liveOnSite === true && <Chip label="Live on the site" state="good" />}
          {rule.running && status.liveOnSite === false && <Chip icon="clock" label="Going live" state="neutral" />}
        </div>
        <span className="ui-faint ui-small">
          Flag <Code>{rule.flagKey}</Code> · {rule.environmentKey}
        </span>
        <span style={{fontSize: 13}}>
          {formatPercent(rule.trafficPercent)} of {audienceNames.length ? audienceNames.join(' or ') : 'all visitors'} on{' '}
          <Code wrap>{rule.route || 'every page'}</Code>
        </span>
        {rule.running && status.liveOnSite === false && (
          <span className="ui-muted ui-small">Going live on the site, usually within a minute.</span>
        )}
        <Group flexWrap="wrap" gap="8">
          <Button
            appearance={rule.running ? 'default' : 'primary'}
            disabled={!rule.running && blocked.length > 0}
            loading={busy === 'setRunning'}
            onClick={() =>
              void run('setRunning', {
                content: contentRef,
                running: !rule.running,
                // The checklist below is the confirmation.
                confirmConflicts: !rule.running && clashing,
              })
            }
            size="sm"
          >
            {rule.running ? 'Pause experiment' : clashing ? 'Start anyway' : 'Start experiment'}
          </Button>
          <OpenLink appearance="subtle" size="sm" url={rule.flagUrl}>
            Open flag in FX
          </OpenLink>
        </Group>
      </div>

      {(!rule.running || problems.length > 0) && (
        <div className="ui-card">
          <div className="ui-card-title">
            <span>{rule.running ? 'Needs attention' : 'Before it starts'}</span>
            {!rule.running && (
              <span className="ui-faint ui-small">
                {problems.length === 0 ? 'ready' : `${problems.length} to look at`}
              </span>
            )}
          </div>
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
        </div>
      )}
      {confirmAlert}

      <div className="ui-card">
        {rule.experimentId ? (
          <ResultsSummary context={context} contentRef={contentRef} controlKey={profile.controlKey} resultsUrl={rule.resultsUrl} />
        ) : (
          <>
            <div className="ui-card-title">
              <span>Results</span>
            </div>
            <span className="ui-muted ui-small">Results appear here once the experiment has started.</span>
          </>
        )}
      </div>

      <div className="ui-card">
        <div className="ui-card-title">
          <span>Variations</span>
          <span className="ui-faint ui-small">traffic · in the CMS</span>
        </div>
        <div>
          {rule.variations.map((v) => {
            const isControl = v.key === profile.controlKey;
            const preview =
              rule.running && status.liveOnSite ? previewUrl(contentRef.publicUrl, previewPath, rule.flagKey, v.key, profile) : null;
            const chip = isControl
              ? status.content.basePublished
                ? {state: 'good' as const, label: 'Published'}
                : {state: 'warn' as const, label: 'Draft'}
              : v.key === 'off'
                ? {state: 'neutral' as const, label: 'Flag off'}
                : cmsChip(cmsStatus.get(v.key));
            return (
              <div className="ui-item" key={v.key}>
                <div className="ui-row" style={{minHeight: 24}}>
                  <span className="ui-name" style={{fontWeight: 500}} title={v.key}>
                    {isControl ? 'Original page' : v.key}
                  </span>
                  <span className="ui-num ui-muted" style={{fontSize: 13}}>
                    {formatPercent(v.percent)}
                  </span>
                </div>
                <div className="ui-row" style={{minHeight: 24}}>
                  <Group alignItems="center" gap="6">
                    <Chip label={chip.label} state={chip.state} />
                    {editing === v.key && <span className="ui-tag">editing</span>}
                  </Group>
                  <div className="ui-actions">
                    {preview && (
                      <OpenLink appearance="subtle" size="sm" url={preview}>
                        Preview
                      </OpenLink>
                    )}
                    {!isControl && v.key !== 'off' && (
                      <Button
                        appearance="subtle"
                        aria-label={`Remove ${v.key} from the test`}
                        loading={busy === 'removeVariations'}
                        onClick={() => void run('removeVariations', {content: contentRef, variations: [v.key], confirmRunning: false})}
                        size="sm"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {diff.missingInFx.map((name) => (
            <div className="ui-item" key={name}>
              <div className="ui-row" style={{minHeight: 24}}>
                <span className="ui-name" style={{fontWeight: 500}} title={name}>
                  {name}
                </span>
                <span className="ui-faint" style={{fontSize: 13}}>
                  –
                </span>
              </div>
              <Group alignItems="center" gap="6">
                <Chip icon="dash" label="Not in the test" state="neutral" />
                {editing === name && <span className="ui-tag">editing</span>}
              </Group>
            </div>
          ))}
        </div>
        {diff.missingInFx.length > 0 && (
          <div>
            <Button
              loading={busy === 'syncVariations'}
              onClick={() => void run('syncVariations', {content: contentRef, confirmRunning: false})}
              size="sm"
            >
              Add {diff.missingInFx.join(', ')} to the experiment
            </Button>
          </div>
        )}
        {diff.invalid.map((i) => (
          <span className="ui-small" key={i.name} style={{color: 'var(--ui-warn-text)'}}>
            {i.name}: {i.reason}
          </span>
        ))}
      </div>

      <div className="ui-card" data-folded="">
        <Disclosure>
          <DisclosureTrigger>
            <Text fontSize="sm" fontWeight="600">
              Settings: traffic, audiences, metrics, URLs
            </Text>
          </DisclosureTrigger>
          <DisclosureContent>
            <Group flexDirection="column" gap="12" pb="8" pl="12" pr="8" pt="4">
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
                <Text fontSize="sm" fontWeight="500">
                  Audiences
                </Text>
                <AudiencePicker audiences={audiences} onChange={setAudienceIds} selected={audienceIds} />
                {audiencesDirty && (
                  <Button
                    loading={busy === 'setAudiences'}
                    onClick={() => void run('setAudiences', {content: contentRef, audienceIds})}
                    size="sm"
                  >
                    Save audiences
                  </Button>
                )}
              </Group>

              <Group flexDirection="column" gap="4">
                <Text fontSize="sm" fontWeight="500">
                  Metrics
                </Text>
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
      </div>

      {error && <Alert intent="danger">{error}</Alert>}
      <Group flexDirection="column" gap="4">
        <Group flexWrap="wrap" gap="8">
          <Button onClick={() => setEnding(true)} size="sm">
            End experiment
          </Button>
          {unlinkButton}
        </Group>
        <span className="ui-faint ui-small">Unlinking only removes the connection here. The flag and its results stay in FX.</span>
      </Group>
    </Group>
  );
}
