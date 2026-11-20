import type {ExperimentResults} from '@shared/types';

import {Icon} from './ui';

const percent = (n: number) => `${(n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0)}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${percent(n)}`;
const UPDATED = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

/**
 * One experiment's primary metric: visitors, conversion rate and lift per variation,
 * significant lifts marked, and a one-line verdict. Display only; the caller loads the
 * results (from GET /v2/experiments/{layer_experiment_id}/results via summarizeResults).
 * Compact enough for the 340px sidebar: numbers never wrap, a long variation name ellipsizes.
 */
export function ResultsTable({results, controlKey}: {results: ExperimentResults; controlKey: string}) {
  const label = (key: string | null, name: string) => (key === controlKey ? 'Original page' : (key ?? name));

  if (results.visitors === 0) {
    return <span className="ui-muted ui-small">No visitors yet. FX updates the numbers every few minutes.</span>;
  }
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
      <table className="ui-table" data-compact="">
        <thead>
          <tr>
            <th>Variation</th>
            <th style={{textAlign: 'right'}}>Visitors</th>
            <th style={{textAlign: 'right'}}>Rate</th>
            <th style={{textAlign: 'right'}}>Lift</th>
          </tr>
        </thead>
        <tbody>
          {results.variations.map((v) => {
            const name = label(v.key, v.name);
            const tone = v.significant ? (v.key === results.leader ? 'good' : 'bad') : null;
            return (
              <tr key={v.name}>
                <td style={{maxWidth: 120}}>
                  <span className="ui-name" style={{fontWeight: 500}} title={name}>
                    {name}
                  </span>
                </td>
                <td className="ui-num" style={{textAlign: 'right'}}>
                  {v.samples.toLocaleString('en-GB')}
                </td>
                <td className="ui-num" style={{textAlign: 'right'}}>
                  {v.rate === null ? '–' : percent(v.rate)}
                </td>
                <td className="ui-num" style={{textAlign: 'right'}}>
                  {v.isBaseline ? (
                    <span className="ui-faint">base</span>
                  ) : v.lift === null ? (
                    '–'
                  ) : (
                    <span
                      style={{
                        color: tone ? `var(--ui-${tone}-text)` : undefined,
                        fontWeight: tone ? 600 : undefined,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      {signed(v.lift)}
                      {v.significant && <Icon name="check" size={12} />}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="ui-faint ui-small">
        {results.leader
          ? `${label(results.leader, results.leader)} is winning with statistical significance (✓).`
          : 'No significant winner yet (✓ marks a significant lift).'}
        {results.lastCalculated ? ` Updated ${UPDATED.format(new Date(results.lastCalculated))}.` : ''}
      </span>
    </div>
  );
}
