import {Alert, Button, Field, Group, Heading, Select, SelectContent, SelectTrigger, Spinner, Text} from '@optiaxiom/react';
import type {CmsFlagOption} from '@shared/types';
import {useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import type {PanelProps} from './types';

/** Adopts a flag that already drives CMS content, picked from the ones FX has. Nothing in FX changes. */
export function LinkExistingForm({context, contentRef, status, onStatus, onCancel}: PanelProps & {onCancel: () => void}) {
  const [flags, setFlags] = useState<CmsFlagOption[] | null>(null);
  const [flagKey, setFlagKey] = useState('');
  const [ruleKey, setRuleKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call(context, 'listCmsFlags', {}).then(setFlags, (e: unknown) => {
      setFlags([]);
      setError(errorMessage(e));
    });
  }, [context]);

  const flag = flags?.find((f) => f.flagKey === flagKey);
  const rule = flag?.rules.find((r) => r.key === ruleKey) ?? flag?.rules[0];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(
        await call(context, 'linkExisting', {
          content: contentRef,
          displayName: status.content.displayName,
          flagKey,
          ruleKey: rule?.key,
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
        For a test already set up in Feature Experimentation. Nothing in FX changes.
      </Text>
      {!flags && <Spinner size="sm" />}
      {flags && flags.length === 0 && !error && (
        <Text color="fg.secondary" fontSize="sm">No flags in this project drive CMS content with an A/B rule.</Text>
      )}
      {flags && flags.length > 0 && (
        <Field label="Flag" required>
          <Select
            onValueChange={(value) => {
              setFlagKey(value);
              setRuleKey('');
            }}
            options={flags.map((f) => ({
              label: f.name,
              value: f.flagKey,
              description: f.linked ? `${f.flagKey} · already linked to a page` : f.flagKey,
            }))}
            value={flagKey}
          >
            <SelectTrigger placeholder="Pick a flag" />
            <SelectContent />
          </Select>
        </Field>
      )}
      {flag && flag.rules.length > 1 && (
        <Field label="Experiment rule">
          <Select
            onValueChange={setRuleKey}
            options={flag.rules.map((r) => ({label: r.name, value: r.key, description: r.enabled ? 'Running' : 'Not running'}))}
            value={rule?.key ?? ''}
          >
            <SelectTrigger />
            <SelectContent />
          </Select>
        </Field>
      )}
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
