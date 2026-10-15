import {Alert, Button, Checkbox, Field, Group, Heading, Input, Separator, Switch, Text} from '@optiaxiom/react';
import {CONTROL_VARIATION_KEY} from '@shared/constants';
import {experimentKeys, flagKeyProblem, routeProblem, splitTraffic} from '@shared/experiment';
import {useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {MetricPicker} from '../common/MetricPicker';
import {formatPercent} from '../common/StatusBadge';
import type {PanelProps} from './types';

export function CreatePanel(props: PanelProps) {
  const {context, contentRef, status, events, loadEvents, createEvent, onStatus, onRefresh} = props;
  const invalid = new Set(status.diff.invalid.map((i) => i.name));
  const valid = status.cmsVariations.filter((v) => !invalid.has(v.name)).map((v) => v.name);

  const [flagKey, setFlagKey] = useState(status.content.suggestedFlagKey);
  const [flagName, setFlagName] = useState(status.content.displayName);
  const [route, setRoute] = useState(status.content.suggestedRoute);
  const [chosen, setChosen] = useState<string[]>(valid);
  const [traffic, setTraffic] = useState('100');
  const [eventIds, setEventIds] = useState<number[]>([]);
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  if (status.cmsVariations.length === 0) {
    return (
      <Group flexDirection="column" gap="8">
        <Alert intent="information">
          This page has no variations yet. Add one from the editor&apos;s Variations dropdown and name it
          exactly as the FX variation key you want (for example <code>business</code>). Then refresh.
        </Alert>
        <Button onClick={onRefresh}>Refresh</Button>
      </Group>
    );
  }

  const flagError = flagKeyProblem(flagKey);
  const routeError = routeProblem(route);
  const trafficN = Number(traffic);
  const trafficError = trafficN >= 1 && trafficN <= 100 ? null : 'Between 1 and 100.';
  const canSubmit = !flagError && !routeError && !trafficError && chosen.length > 0 && !busy;
  const arms = splitTraffic(experimentKeys(chosen));

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
          trafficPercent: trafficN,
          start,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (linking) return <LinkExistingForm {...props} onCancel={() => setLinking(false)} />;

  return (
    <Group flexDirection="column" gap="12">
      <Text color="fg.secondary" fontSize="sm">
        Creates an FX flag with one variation per CMS variation, plus <code>{CONTROL_VARIATION_KEY}</code> for the
        original page, and an A/B rule in <b>{status.settings.environmentKey}</b>.
      </Text>

      <Field error={flagError} label="Flag key" required>
        <Input onChange={(e) => setFlagKey(e.target.value.trim())} value={flagKey} />
      </Field>
      <Field label="Flag name">
        <Input onChange={(e) => setFlagName(e.target.value)} value={flagName} />
      </Field>
      <Field
        description="Path the site serves this experiment on. Comma-separate several; /prefix/* matches a section."
        error={routeError}
        label="Route"
        required
      >
        <Input onChange={(e) => setRoute(e.target.value)} placeholder="/savings" value={route} />
      </Field>

      <Group flexDirection="column" gap="4">
        <Text fontSize="sm" fontWeight="500">Variations</Text>
        <Checkbox checked description="Serves the original page" disabled size="sm">
          {CONTROL_VARIATION_KEY}
        </Checkbox>
        {valid.map((name) => (
          <Checkbox
            checked={chosen.includes(name)}
            description={name === status.content.currentVariation ? 'The variation you are editing' : undefined}
            key={name}
            onChange={() => toggle(name)}
            size="sm"
          >
            {name}
          </Checkbox>
        ))}
        {status.diff.invalid.map((i) => (
          <Text color="fg.warning" fontSize="xs" key={i.name}>
            {i.name}: {i.reason}
          </Text>
        ))}
        <Text color="fg.secondary" fontSize="xs">
          Split: {arms.map((a) => `${a.key} ${formatPercent(a.weight / 100)}`).join(' · ')}
        </Text>
      </Group>

      <Field description="Share of eligible visitors who enter the experiment." error={trafficError} label="Traffic (%)">
        <Input max={100} min={1} onChange={(e) => setTraffic(e.target.value)} type="number" value={traffic} />
      </Field>
      {status.settings.audienceIds.length > 0 && (
        <Text color="fg.secondary" fontSize="xs">
          Audience: {status.settings.audienceIds.join(', ')} (from app settings)
        </Text>
      )}

      <Group flexDirection="column" gap="4">
        <Text fontSize="sm" fontWeight="500">Metrics</Text>
        <MetricPicker events={events} onChange={setEventIds} onCreateEvent={createEvent} selected={eventIds} />
      </Group>

      <Switch checked={start} onCheckedChange={setStart}>
        Start the experiment now
      </Switch>

      {error && <Alert intent="danger">{error}</Alert>}
      <Button appearance="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
        Create experiment
      </Button>

      <Separator />
      <Button appearance="subtle" onClick={() => setLinking(true)}>
        Link an existing flag instead
      </Button>
    </Group>
  );
}

function LinkExistingForm({context, contentRef, status, onStatus, onCancel}: PanelProps & {onCancel: () => void}) {
  const [flagKey, setFlagKey] = useState('');
  const [ruleKey, setRuleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(
        await call(context, 'linkExisting', {
          content: contentRef,
          displayName: status.content.displayName,
          flagKey,
          ruleKey: ruleKey || undefined,
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
      <Heading level="4">Link an existing flag</Heading>
      <Text color="fg.secondary" fontSize="sm">
        For a flag that already drives this page (it needs a <code>cms_flag</code> variable). Nothing in FX changes.
      </Text>
      <Field label="Flag key" required>
        <Input onChange={(e) => setFlagKey(e.target.value.trim())} placeholder="homepage" value={flagKey} />
      </Field>
      <Field description="Leave blank to use the flag's first A/B rule." label="Rule key">
        <Input onChange={(e) => setRuleKey(e.target.value.trim())} value={ruleKey} />
      </Field>
      {error && <Alert intent="danger">{error}</Alert>}
      <Group gap="8">
        <Button appearance="primary" disabled={!flagKey} loading={busy} onClick={() => void submit()}>
          Link flag
        </Button>
        <Button appearance="subtle" onClick={onCancel}>Back</Button>
      </Group>
    </Group>
  );
}
