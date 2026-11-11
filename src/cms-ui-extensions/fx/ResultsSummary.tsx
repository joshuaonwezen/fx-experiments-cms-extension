import {Button, Group, Spinner, Text} from '@optiaxiom/react';
import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {ContentRef, ExperimentResults} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {ResultsTable} from '../common/ResultsTable';

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
      {results && <ResultsTable controlKey={controlKey} results={results} />}
      {resultsUrl && (
        <OpenLink appearance="subtle" url={resultsUrl}>
          Full results in FX
        </OpenLink>
      )}
    </Group>
  );
}
