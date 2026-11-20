import {Button, Group, Spinner} from '@optiaxiom/react';
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
      <div className="ui-card-title">
        <span>Results{results ? `: ${results.metric}` : ''}</span>
        <Button appearance="subtle" loading={loading} onClick={() => void load()} size="sm">
          Refresh
        </Button>
      </div>
      {loading && !results && !note && <Spinner size="sm" />}
      {note && <span className="ui-muted ui-small">{note}</span>}
      {results && <ResultsTable controlKey={controlKey} results={results} />}
      {resultsUrl && (
        <div>
          <OpenLink appearance="subtle" size="sm" url={resultsUrl}>
            Full results in FX
          </OpenLink>
        </div>
      )}
    </Group>
  );
}
