import {Alert, Button, Group, Heading, Radio, RadioGroup, Text} from '@optiaxiom/react';
import type {ShipVia} from '@shared/types';
import {useState} from 'react';

import {OpenLink} from '../common/OpenLink';
import type {PanelProps, Run} from './types';

const NO_WINNER = '__none__';

/** Pick the winner and how it reaches visitors, then end the test. */
export function EndPanel({
  contentRef,
  status,
  run,
  busy,
  error,
  onCancel,
}: PanelProps & {run: Run; busy: boolean; error: string | null; onCancel: () => void}) {
  const {rule} = status;
  const {profile} = status.settings;
  const [winner, setWinner] = useState('');
  const [shipVia, setShipVia] = useState<ShipVia | ''>('');
  if (!rule) return null;

  const cmsStatus = new Map(status.cmsVariations.map((v) => [v.name, v.status]));
  const variationWon = winner !== '' && winner !== NO_WINNER && winner !== profile.controlKey;
  const winnerPublished = variationWon && cmsStatus.get(winner) === 'published';
  const ready = winner !== '' && (!variationWon || shipVia !== '');

  const submit = () =>
    void run('endExperiment', {
      content: contentRef,
      winner: winner === NO_WINNER ? null : winner,
      shipVia: variationWon && shipVia ? shipVia : null,
    });

  return (
    <Group flexDirection="column" gap="12">
      <Heading level="4">End experiment</Heading>
      <Text color="fg.secondary" fontSize="sm">
        Check the results in FX first, then pick what visitors should see from now on. The test stops either way.
      </Text>
      {rule.resultsUrl && <OpenLink url={rule.resultsUrl}>View results</OpenLink>}

      <Group flexDirection="column" gap="4">
        <Text fontSize="sm" fontWeight="500">Winner</Text>
        <RadioGroup onValueChange={setWinner} value={winner}>
          {rule.variations
            .filter((v) => v.key !== 'off')
            .map((v) => (
              <Radio key={v.key} value={v.key}>
                {v.key === profile.controlKey ? 'The original page' : v.key}
              </Radio>
            ))}
          <Radio description="Visitors keep seeing the original page." value={NO_WINNER}>
            No clear winner
          </Radio>
        </RadioGroup>
      </Group>

      {variationWon && (
        <Group flexDirection="column" gap="4">
          <Text fontSize="sm" fontWeight="500">How visitors get {winner}</Text>
          <RadioGroup onValueChange={(v) => setShipVia(v as ShipVia)} value={shipVia}>
            <Radio
              description="Instant and easy to undo. FX serves the variation to everyone; it stays in the CMS."
              value="fx"
            >
              Serve it to everyone from FX
            </Radio>
            <Radio
              description={
                winnerPublished
                  ? "Publishes the variation's content as the page itself. Afterwards the test's variations can be deleted."
                  : `Publish ${winner} first; only published content can become the page.`
              }
              disabled={!winnerPublished}
              value="cms"
            >
              Make it the page in the CMS
            </Radio>
          </RadioGroup>
        </Group>
      )}

      {error && <Alert intent="danger">{error}</Alert>}
      <Group gap="8">
        <Button appearance="primary" disabled={!ready} loading={busy} onClick={submit}>
          End experiment
        </Button>
        <Button appearance="subtle" onClick={onCancel}>Cancel</Button>
      </Group>
    </Group>
  );
}
