import {Button, Group, Text} from '@optiaxiom/react';
import {useState, type ReactNode} from 'react';

import {copyToClipboard} from './clipboard';

/**
 * A button that opens `url` in a new tab. The extension runs in a CMS iframe whose
 * sandbox may block popups; only when window.open really comes back null does it show
 * the URL with a copy button instead.
 */
export function OpenLink({
  url,
  children,
  appearance = 'default',
}: {
  url: string;
  children: ReactNode;
  appearance?: 'default' | 'primary' | 'subtle';
}) {
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = () => {
    let opened: Window | null = null;
    try {
      // Not the "noopener" feature: with it window.open returns null even when the tab
      // opened, so a blocked popup can't be told apart. Cut the opener link instead.
      opened = window.open(url, '_blank');
      if (opened) opened.opener = null;
    } catch {
      opened = null;
    }
    setBlocked(!opened);
  };

  return (
    <Group flexDirection="column" gap="4">
      <Button appearance={appearance} onClick={open}>
        {children}
      </Button>
      {blocked && (
        <Group alignItems="center" gap="4">
          <Text color="fg.secondary" fontSize="xs" style={{flex: 1, minWidth: 0, overflowWrap: 'anywhere'}}>
            {url}
          </Text>
          <Button
            appearance="subtle"
            onClick={() => void copyToClipboard(url).then(setCopied)}
            size="sm"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Group>
      )}
    </Group>
  );
}
