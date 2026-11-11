import {Alert, Badge, Button, Field, Group, Input, Separator, Text} from '@optiaxiom/react';
import {useState, type ReactNode} from 'react';

import {ResultsSummary} from './ResultsSummary';
import type {PanelProps, Run, StatusAction} from './types';

const CONFIRM_WORD = 'delete';

/** An ended experiment: how the winner shipped, cleaning up its variations, archiving the flag. */
export function EndedPanel({
  context,
  contentRef,
  status,
  run,
  busy,
  error,
  confirmAlert,
  unlinkButton,
}: PanelProps & {
  run: Run;
  busy: StatusAction | null;
  error: string | null;
  confirmAlert: ReactNode;
  unlinkButton: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const [archiving, setArchiving] = useState(false);
  const ended = status.link?.conclusion;
  if (!status.link || !ended) return null;

  const {profile, allowDelete} = status.settings;
  const winner = ended.winner;
  const original = !winner || winner === profile.controlKey;
  const candidates = status.deleteCandidates;
  const versionCount = candidates.reduce((n, c) => n + c.versions.length, 0);
  const resume = () =>
    void run('endExperiment', {content: contentRef, winner: ended.winner, shipVia: ended.shipVia});

  return (
    <Group flexDirection="column" gap="12">
      <Group alignItems="center" gap="8">
        <Badge intent="information" variant="subtle">ended</Badge>
        <Text color="fg.secondary" fontSize="xs">{new Date(ended.endedAt).toLocaleDateString()}</Text>
      </Group>

      {original && (
        <Text fontSize="sm">
          {winner ? 'The original page won.' : 'Ended without a winner.'} Visitors see the original page.
        </Text>
      )}
      {!original && ended.shipVia === 'fx' && (
        <Text fontSize="sm">
          <b>{winner}</b> won. FX serves it to everyone through the rule <code>{ended.deliveryRuleKey}</code>.
        </Text>
      )}
      {!original && ended.shipVia === 'cms' && ended.promotion === 'published' && (
        <Text fontSize="sm">
          <b>{winner}</b> won and is now the published page.
        </Text>
      )}
      {!original && ended.shipVia === 'cms' && ended.promotion !== 'published' && (
        <Alert intent="warning">
          <Group flexDirection="column" gap="8">
            <Text fontSize="sm">
              <b>{winner}</b> won. Its content is in a new version of the page that still needs approval in the CMS.
              Visitors see the original page until it is published.
            </Text>
            <Button loading={busy === 'endExperiment'} onClick={resume} size="sm">
              Check again
            </Button>
          </Group>
        </Alert>
      )}
      {status.rule?.experimentId && (
        <ResultsSummary
          context={context}
          contentRef={contentRef}
          controlKey={profile.controlKey}
          resultsUrl={status.rule.resultsUrl}
        />
      )}

      {candidates.length > 0 && (
        <>
          <Separator />
          <Text fontSize="sm" fontWeight="500">Clean up the CMS</Text>
          <Text fontSize="sm">
            No longer needed: {candidates.map((c) => c.name).join(', ')} ({versionCount}{' '}
            {versionCount === 1 ? 'version' : 'versions'}). Nothing else on this page uses{' '}
            {candidates.length === 1 ? 'it' : 'them'}.
          </Text>
          {allowDelete ? (
            <Group flexDirection="column" gap="8">
              <Field description="Deleting is permanent and cannot be undone." label={`Type "${CONFIRM_WORD}" to confirm`}>
                <Input onChange={(e) => setTyped(e.target.value)} value={typed} />
              </Field>
              <Button
                appearance="danger"
                disabled={typed.trim().toLowerCase() !== CONFIRM_WORD}
                loading={busy === 'deleteVariations'}
                onClick={() =>
                  void run('deleteVariations', {content: contentRef, confirm: candidates.map((c) => c.name)}).then(() =>
                    setTyped(''),
                  )
                }
              >
                Delete {candidates.length === 1 ? 'variation' : `${candidates.length} variations`}
              </Button>
            </Group>
          ) : (
            <Text color="fg.secondary" fontSize="sm">
              Delete them in the editor, or ask an admin to let this extension delete variations (app settings).
            </Text>
          )}
        </>
      )}
      {(ended.notDeleted?.length ?? 0) > 0 && (
        <Alert intent="warning">
          <Group flexDirection="column" gap="4">
            <Text fontSize="sm">
              The CMS kept these versions. Visitors no longer get them; remove them in the editor&apos;s Versions panel.
            </Text>
            {ended.notDeleted!.map((n) => (
              <Text fontSize="xs" key={`${n.name}:${n.version}`} style={{overflowWrap: 'anywhere'}}>
                {n.name} v{n.version}: {n.reason}
              </Text>
            ))}
          </Group>
        </Alert>
      )}
      {(ended.deleted?.length ?? 0) > 0 && (
        <Text color="fg.secondary" fontSize="sm">Deleted: {ended.deleted!.join(', ')}.</Text>
      )}

      {confirmAlert}
      {error && <Alert intent="danger">{error}</Alert>}
      <Separator />
      {ended.archived ? (
        <Text color="fg.secondary" fontSize="sm">The flag is archived in FX.</Text>
      ) : ended.shipVia !== 'fx' && !archiving ? (
        <Button appearance="subtle" onClick={() => setArchiving(true)}>Archive the flag in FX</Button>
      ) : null}
      {archiving && !ended.archived && (
        <Alert intent="warning">
          <Group flexDirection="column" gap="8">
            <Text fontSize="sm">
              Archives <code>{status.link.flagKey}</code> in every environment. Its results stay in FX.
            </Text>
            <Group gap="8">
              <Button
                appearance="primary"
                loading={busy === 'archiveFlag'}
                onClick={() => void run('archiveFlag', {content: contentRef}).then(() => setArchiving(false))}
                size="sm"
              >
                Archive
              </Button>
              <Button appearance="subtle" onClick={() => setArchiving(false)} size="sm">Cancel</Button>
            </Group>
          </Group>
        </Alert>
      )}
      <Text color="fg.secondary" fontSize="xs">
        Unlink to run a new experiment on this page. The flag and its results stay in FX.
      </Text>
      {unlinkButton}
    </Group>
  );
}
