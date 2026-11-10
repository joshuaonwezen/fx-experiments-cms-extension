import {Button, Group, Text} from '@optiaxiom/react';
import type {ReadinessItem} from '@shared/readiness';

const MARK = {ok: '✓', warn: '!', block: '✕'};

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
            <Text
              color={tone === 'ok' ? 'fg.success' : tone === 'block' ? 'fg.error' : 'fg.warning'}
              fontSize="sm"
              fontWeight="600"
              style={{width: 12, flexShrink: 0}}
            >
              {MARK[tone]}
            </Text>
            <Group flexDirection="column" gap="4" style={{flex: 1, minWidth: 0}}>
              <Text fontSize="sm" style={{overflowWrap: 'anywhere'}}>
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
