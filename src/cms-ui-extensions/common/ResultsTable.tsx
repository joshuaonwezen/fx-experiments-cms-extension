import {Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text} from '@optiaxiom/react';
import type {ExperimentResults} from '@shared/types';

const percent = (n: number) => `${(n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${percent(n)}`;

/**
 * One experiment's primary metric: visitors, conversion rate and lift per variation,
 * significant lifts marked, and a one-line verdict. Display only; the caller loads the
 * results (from GET /v2/experiments/{layer_experiment_id}/results via summarizeResults).
 */
export function ResultsTable({results, controlKey}: {results: ExperimentResults; controlKey: string}) {
  const label = (key: string | null, name: string) => (key === controlKey ? 'Original page' : (key ?? name));

  if (results.visitors === 0) {
    return <Text color="fg.secondary" fontSize="sm">No visitors yet. FX updates the numbers every few minutes.</Text>;
  }
  return (
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
  );
}
