import {Chip, type ChipState, type IconName} from './ui';

const SHOWN: Record<string, {state: ChipState; label: string; icon?: IconName}> = {
  running: {state: 'good', label: 'Running', icon: 'play'},
  paused: {state: 'warn', label: 'Paused', icon: 'pause'},
  draft: {state: 'neutral', label: 'Draft'},
  not_started: {state: 'neutral', label: 'Not started'},
  concluded: {state: 'draft', label: 'Concluded', icon: 'check'},
};

/** An FX rule's status as a chip, the words visitors' experience matches. */
export function StatusBadge({status, running}: {status: string; running: boolean}) {
  // A rule can report "running" while its ruleset is off; show what visitors get.
  const shown = status === 'running' && !running ? 'paused' : status;
  const known = SHOWN[shown];
  if (known) return <Chip icon={known.icon} label={known.label} state={known.state} />;
  const words = shown.replace(/_/g, ' ');
  return <Chip label={words.charAt(0).toUpperCase() + words.slice(1)} state="neutral" />;
}

export function formatPercent(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}
