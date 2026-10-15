import {Badge} from '@optiaxiom/react';

const INTENT: Record<string, 'success' | 'warning' | 'neutral' | 'information'> = {
  running: 'success',
  paused: 'warning',
  draft: 'neutral',
  not_started: 'neutral',
  concluded: 'information',
};

export function StatusBadge({status, running}: {status: string; running: boolean}) {
  // A rule can report "running" while its ruleset is off; show what visitors get.
  const shown = status === 'running' && !running ? 'paused' : status;
  return (
    <Badge intent={INTENT[shown] ?? 'information'} variant="subtle">
      {shown.replace(/_/g, ' ')}
    </Badge>
  );
}

export function formatPercent(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}
