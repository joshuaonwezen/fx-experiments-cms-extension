import {
  Alert,
  Button,
  Checkbox,
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Field,
  Group,
  Input,
  Switch,
  Text,
} from '@optiaxiom/react';
import {experimentKeys, flagKeyProblem, routeProblem, splitTraffic, uncoveredPaths, withPaths} from '@shared/experiment';
import {blockers, readiness} from '@shared/readiness';
import {useEffect, useState} from 'react';

import {AudiencePicker} from '../common/AudiencePicker';
import {call, errorMessage} from '../common/api';
import {MetricPicker} from '../common/MetricPicker';
import {formatPercent} from '../common/StatusBadge';
import {Code} from '../common/ui';
import {LinkExistingForm} from './LinkExistingForm';
import {ReadinessChecklist} from './ReadinessChecklist';
import type {PanelProps} from './types';

export function CreatePanel(props: PanelProps) {
  const {context, contentRef, status, events, loadEvents, createEvent, audiences, loadAudiences, onStatus, onRefresh} =
    props;
  const {profile} = status.settings;
  const invalid = new Set(status.diff.invalid.map((i) => i.name));
  const valid = status.cmsVariations.filter((v) => !invalid.has(v.name));

  const [flagKey, setFlagKey] = useState(status.content.suggestedFlagKey);
  const [flagName, setFlagName] = useState(status.content.displayName);
  const [route, setRoute] = useState(status.content.suggestedRoute);
  const [chosen, setChosen] = useState<string[]>(valid.map((v) => v.name));
  const [traffic, setTraffic] = useState('100');
  const [eventIds, setEventIds] = useState<number[]>([]);
  const [audienceIds, setAudienceIds] = useState<number[]>([]);
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    void loadEvents();
    void loadAudiences();
  }, [loadEvents, loadAudiences]);

  const flagError = flagKeyProblem(flagKey, profile);
  const routeError = routeProblem(route);
  const missingPaths = routeError ? [] : uncoveredPaths(route, status.content.visitorPaths);
  // Advanced opens itself when something in it needs attention (and stays open).
  const advancedNeeded = Boolean(flagError || routeError || missingPaths.length > 0);
  useEffect(() => {
    if (advancedNeeded) setAdvancedOpen(true);
  }, [advancedNeeded]);

  if (linking) return <LinkExistingForm {...props} onCancel={() => setLinking(false)} />;

  if (status.cmsVariations.length === 0) {
    return (
      <Group flexDirection="column" gap="8">
        <Alert intent="information">
          <Text fontSize="sm">
            This page has no variations yet. Add one from the editor&apos;s Variations menu and give it a short name
            such as <Code>business</Code>, then refresh.
          </Text>
        </Alert>
        <Group gap="8">
          <Button onClick={onRefresh} size="sm">
            Refresh
          </Button>
          <Button appearance="subtle" onClick={() => setLinking(true)} size="sm">
            Link an existing flag instead
          </Button>
        </Group>
      </Group>
    );
  }

  const trafficN = Number(traffic);
  const trafficError = trafficN >= 1 && trafficN <= 100 ? null : 'Between 1 and 100.';
  const items = readiness({
    basePublished: status.content.basePublished,
    arms: chosen,
    cmsVariations: status.cmsVariations,
    metricCount: eventIds.length,
    route: routeError ? '' : route,
    visitorPaths: status.content.visitorPaths,
    running: status.runningExperiments,
    profile,
  });
  const blocked = blockers(items);
  const clashing = items.some((i) => i.key === 'clash' && !i.ok && status.runningExperiments !== null);
  const canSubmit = !flagError && !routeError && !trafficError && chosen.length > 0 && !busy && !(start && blocked.length);
  const arms = splitTraffic(experimentKeys(chosen, profile.controlKey));

  const toggle = (name: string) =>
    setChosen((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(
        await call(context, 'createExperiment', {
          content: contentRef,
          displayName: status.content.displayName,
          flagKey,
          flagName,
          route,
          variations: chosen,
          eventIds,
          audienceIds,
          trafficPercent: trafficN,
          start,
          // The checklist above the button is the confirmation.
          confirmConflicts: start && clashing,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group flexDirection="column" gap="12">
      <Text color="fg.secondary" fontSize="sm">
        Test this page&apos;s variations against the original. Visitors are split between them and Feature
        Experimentation measures which one does best.
      </Text>

      <div className="ui-card">
        <div className="ui-card-title">
          <span>1. Variations to test</span>
        </div>
        <Checkbox checked description="Visitors who see the page unchanged" disabled size="sm">
          Original page
        </Checkbox>
        {valid.map((v) => (
          <Checkbox
            checked={chosen.includes(v.name)}
            description={
              v.status !== 'published'
                ? `${v.status === 'draft' ? 'Draft' : 'Not published'}: publish it before the test starts`
                : v.name === status.content.currentVariation
                  ? 'The variation you are editing'
                  : undefined
            }
            key={v.name}
            onChange={() => toggle(v.name)}
            size="sm"
          >
            {v.name}
          </Checkbox>
        ))}
        {status.diff.invalid.map((i) => (
          <span className="ui-small" key={i.name} style={{color: 'var(--ui-warn-text)'}}>
            <Code>{i.name}</Code> {i.reason}
          </span>
        ))}
        {chosen.length > 0 && (
          <span className="ui-faint ui-small">
            Each gets {arms.map((a) => `${a.key === profile.controlKey ? 'original' : a.key} ${formatPercent(a.weight / 100)}`).join(' · ')}
          </span>
        )}
      </div>

      <div className="ui-card">
        <div className="ui-card-title">
          <span>2. What counts as success</span>
        </div>
        <MetricPicker events={events} onChange={setEventIds} onCreateEvent={createEvent} selected={eventIds} />
      </div>

      <div className="ui-card">
        <div className="ui-card-title">
          <span>3. Who takes part</span>
        </div>
        <AudiencePicker audiences={audiences} onChange={setAudienceIds} selected={audienceIds} />
        <Field description="Share of those visitors who enter the test." error={trafficError} label="Traffic (%)">
          <Input max={100} min={1} onChange={(e) => setTraffic(e.target.value)} type="number" value={traffic} />
        </Field>
      </div>

      <div className="ui-card" data-folded="">
      <Disclosure onOpenChange={setAdvancedOpen} open={advancedOpen}>
        <DisclosureTrigger>
          <Text fontSize="sm" fontWeight="600">
            Advanced: flag and URLs
          </Text>
        </DisclosureTrigger>
        <DisclosureContent>
          <Group flexDirection="column" gap="12" pb="8" pl="12" pr="8" pt="4">
            <Field error={flagError} label="Flag key" required>
              <Input onChange={(e) => setFlagKey(e.target.value.trim())} value={flagKey} />
            </Field>
            <Field label="Flag name">
              <Input onChange={(e) => setFlagName(e.target.value)} value={flagName} />
            </Field>
            <Field
              description="The URLs the test runs on. Comma-separate several; /section/* covers a whole section."
              error={routeError}
              label="Route"
              required
            >
              <Input onChange={(e) => setRoute(e.target.value)} placeholder="/savings" value={route} />
            </Field>
          </Group>
        </DisclosureContent>
      </Disclosure>
      </div>

      <div className="ui-card">
        <div className="ui-card-title">
          <span>Before it starts</span>
          <span className="ui-faint ui-small">{blocked.length === 0 ? 'ready' : `${blocked.length} to fix`}</span>
        </div>
        <ReadinessChecklist
          items={items}
          onFixRoute={missingPaths.length > 0 ? () => setRoute(withPaths(route, status.content.visitorPaths)) : undefined}
        />
      </div>
      <Switch checked={start} disabled={blocked.length > 0} onCheckedChange={setStart}>
        Start the experiment now
      </Switch>

      {error && <Alert intent="danger">{error}</Alert>}
      <Button appearance="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
        {start && clashing ? 'Create and start anyway' : start ? 'Create and start' : 'Create experiment'}
      </Button>

      <div>
        <Button appearance="subtle" onClick={() => setLinking(true)} size="sm">
          Link an existing flag instead
        </Button>
      </div>
    </Group>
  );
}
