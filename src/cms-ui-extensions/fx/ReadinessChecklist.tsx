import {Button, Group, Text} from '@optiaxiom/react';
import type {ReadinessItem} from '@shared/readiness';

import {Icon, type IconName} from '../common/ui';

const MARK: Record<'ok' | 'warn' | 'block', {icon: IconName; color: string}> = {
  ok: {icon: 'check', color: 'var(--ui-good-text)'},
  warn: {icon: 'alert', color: 'var(--ui-warn-text)'},
  block: {icon: 'cross', color: 'var(--ui-bad-text)'},
};

/**
 * What has to be true before the test starts, one line each. `onlyProblems` hides the
 * lines that pass (used once a test runs). The route line can carry a one-click fix.
 */
export function ReadinessChecklist({
  items,
  onlyProblems = false,
  onFixRoute,
  fixing = false,
}: {
  items: ReadinessItem[];
  onlyProblems?: boolean;
  onFixRoute?: () => void;
  fixing?: boolean;
}) {
  const shown = onlyProblems ? items.filter((i) => !i.ok) : items;
  if (shown.length === 0) return null;
  return (
    <Group flexDirection="column" gap="4">
      {shown.map((item) => {
        const tone = item.ok ? 'ok' : item.blocking ? 'block' : 'warn';
        return (
          <Group alignItems="start" gap="8" key={item.key}>
            <span aria-label={tone === 'ok' ? 'Done' : tone === 'block' ? 'Blocks the start' : 'Worth a look'} role="img" style={{color: MARK[tone].color, flexShrink: 0, paddingTop: 2}}>
              <Icon name={MARK[tone].icon} size={14} />
            </span>
            <Group flexDirection="column" gap="4" style={{flex: 1, minWidth: 0}}>
              <Text fontSize="sm" style={{overflowWrap: 'anywhere', color: item.ok ? 'var(--ui-ink-2)' : undefined}}>
                {item.text}
              </Text>
              {item.key === 'route' && !item.ok && onFixRoute && (
                <Button loading={fixing} onClick={onFixRoute} size="sm">
                  Add the missing URLs
                </Button>
              )}
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}
