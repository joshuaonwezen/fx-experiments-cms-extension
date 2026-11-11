import {Button, Group, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text} from '@optiaxiom/react';
import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {ContentRef, ExperimentResults} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {OpenLink} from '../common/OpenLink';

const percent = (n: number) => `${(n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${percent(n)}`;

/**
 * The primary metric's results, read from FX for the open page: visitors, conversion
 * rate and lift per variation, with significant lifts marked. `onLeader` hears about a
 * variation that wins with significance, so the end-of-test form can preselect it.
 */
export function ResultsSummary({
  context,
  contentRef,
  controlKey,
  resultsUrl,
  onLeader,
}: {
  context: ExtensionContext;
  contentRef: ContentRef;
  controlKey: string;
  resultsUrl: string | null;
  onLeader?: (key: string | null) => void;
}) {
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const answer = await call(context, 'getResults', {content: contentRef});
      setResults(answer.results);
      setNote(answer.note);
      onLeader?.(answer.results?.leader ?? null);
    } catch (e) {
      setNote(`Couldn't load results: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }, [context, contentRef, onLeader]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (key: string | null, name: string) => (key === controlKey ? 'Original page' : (key ?? name));

  return (
    <Group flexDirection="column" gap="8">
      <Group alignItems="center" justifyContent="space-between">
        <Text fontSize="sm" fontWeight="500">
          Results{results ? `: ${results.metric}` : ''}
        </Text>
        <Button appearance="subtle" loading={loading} onClick={() => void load()} size="sm">
          Refresh
        </Button>
      </Group>
      {loading && !results && !note && <Spinner size="sm" />}
      {note && <Text color="fg.secondary" fontSize="sm">{note}</Text>}
      {results && results.visitors === 0 && (
        <Text color="fg.secondary" fontSize="sm">No visitors yet. FX updates the numbers every few minutes.</Text>
      )}
      {results && results.visitors > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Variation</TableHeaderCell>
                <TableHeaderCell>Visitors</TableHeaderCell>
                <TableHeaderCell>Rate</TableHeaderCell>
                <TableHeaderCell>Lift</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.variations.map((v) => (
                <TableRow key={v.name}>
                  <TableCell>{label(v.key, v.name)}</TableCell>
                  <TableCell>{v.samples.toLocaleString()}</TableCell>
                  <TableCell>{v.rate === null ? '-' : percent(v.rate)}</TableCell>
                  <TableCell>
                    {v.isBaseline ? (
                      <Text color="fg.secondary" fontSize="sm">baseline</Text>
                    ) : v.lift === null ? (
                      '-'
                    ) : (
                      <Text
                        color={v.significant ? (v.key === results.leader ? 'fg.success' : 'fg.error') : undefined}
                        fontSize="sm"
                        fontWeight={v.significant ? '600' : undefined}
                      >
                        {signed(v.lift)}
                        {v.significant ? ' ✓' : ''}
                      </Text>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Text color="fg.secondary" fontSize="xs">
            {results.leader
              ? `${label(results.leader, results.leader)} is winning with statistical significance (✓).`
              : 'No significant winner yet (✓ marks a significant lift).'}
            {results.lastCalculated ? ` Updated ${new Date(results.lastCalculated).toLocaleString()}.` : ''}
          </Text>
        </>
      )}
      {resultsUrl && (
        <OpenLink appearance="subtle" url={resultsUrl}>
          Full results in FX
        </OpenLink>
      )}
    </Group>
  );
}
