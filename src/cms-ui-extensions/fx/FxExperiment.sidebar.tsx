import {Alert, AxiomProvider, Box, Button, Group, Heading, Spinner, Text} from '@optiaxiom/react';
import {register, type ContentState, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import {normalizeKey} from '@shared/experiment';
import type {AudienceOption, ContentRef, FxEvent, StatusResult} from '@shared/types';
import {useCallback, useEffect, useRef, useState} from 'react';

import {call, CallError, errorMessage} from '../common/api';
import {CreatePanel} from './CreatePanel';
import {LinkedPanel} from './LinkedPanel';

function toRef(state: ContentState): ContentRef | null {
  if (!state?.key) return null;
  return {key: state.key, locale: state.locale ?? '', version: state.version, publicUrl: state.publicUrl};
}

function sameRef(a: ContentRef | null, b: ContentRef | null): boolean {
  return a?.key === b?.key && a?.locale === b?.locale && a?.version === b?.version && a?.publicUrl === b?.publicUrl;
}

function errorCode(error: Error): string | null {
  return error instanceof CallError ? error.code : null;
}

// An image or folder isn't a failure, just not something to experiment on.
function alertIntent(error: Error): 'information' | 'warning' | 'danger' {
  const code = errorCode(error);
  if (code === 'unsupported_content') return 'information';
  if (code === 'not_configured' || code === 'locale_missing') return 'warning';
  return 'danger';
}

function FxExperiment({context}: {context: ExtensionContext}) {
  const [contentRef, setContentRef] = useState<ContentRef | null>(null);
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [loadError, setLoadError] = useState<CallError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<FxEvent[] | null>(null);
  const [audiences, setAudiences] = useState<AudienceOption[] | null>(null);
  const [removingOther, setRemovingOther] = useState(false);
  const requestId = useRef(0);
  const eventsRequested = useRef(false);
  const audiencesRequested = useRef(false);

  const refresh = useCallback(
    async (ref: ContentRef) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const next = await call(context, 'getStatus', {content: ref});
        if (id !== requestId.current) return;
        setStatus(next);
        setLoadError(null);
      } catch (error) {
        if (id === requestId.current) setLoadError(error as Error);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [context],
  );

  useEffect(() => {
    void context.extension.setReady();
    const apply = (state: ContentState) => {
      const next = toRef(state);
      setContentRef((prev) => (sameRef(prev, next) ? prev : next));
    };
    void context.content.get().then(apply);
    return context.content.subscribe(apply);
  }, [context]);

  // Switching variation in the editor changes the version, so this also re-reads
  // which variation is being edited.
  useEffect(() => {
    if (contentRef) void refresh(contentRef);
    else setStatus(null);
  }, [contentRef, refresh]);

  const loadEvents = useCallback(async () => {
    if (eventsRequested.current) return;
    eventsRequested.current = true;
    try {
      setEvents(await call(context, 'listEvents', {}));
    } catch (error) {
      eventsRequested.current = false;
      setLoadError(error as Error);
    }
  }, [context]);

  const loadAudiences = useCallback(async () => {
    if (audiencesRequested.current) return;
    audiencesRequested.current = true;
    try {
      setAudiences(await call(context, 'listAudiences', {}));
    } catch {
      // The picker falls back to the audience IDs from the app settings.
      setAudiences([]);
    }
  }, [context]);

  const createEvent = useCallback(
    async (key: string, name: string) => {
      const event = await call(context, 'createEvent', {key, name});
      setEvents((prev) => [...(prev ?? []), event].sort((a, b) => a.name.localeCompare(b.name)));
      return event;
    },
    [context],
  );

  const onRefresh = useCallback(() => {
    if (contentRef) void refresh(contentRef);
  }, [contentRef, refresh]);

  // A test that just started reaches the site with the next datafile (FX and its CDN
  // cache it for about a minute); check again until it is there, for up to five minutes.
  const waitingForSite = Boolean(status?.rule?.running && status.liveOnSite === false);
  const polls = useRef(0);
  useEffect(() => {
    if (!waitingForSite) {
      polls.current = 0;
      return undefined;
    }
    if (polls.current >= 15) return undefined;
    const timer = setTimeout(() => {
      polls.current += 1;
      onRefresh();
    }, 20_000);
    return () => clearTimeout(timer);
  }, [waitingForSite, status, onRefresh]);

  const editing = status?.content.currentVariation;
  // Between switching items and the new status arriving, `status` still describes the
  // previous item; hold the panels back so no action mixes the two.
  const current =
    status && contentRef && status.content.key === normalizeKey(contentRef.key) &&
    (!contentRef.locale || status.content.locale === contentRef.locale);

  return (
    <Box p="12">
      <Group flexDirection="column" gap="12">
        {current && status && (
          <Group alignItems="center" justifyContent="space-between">
            <Heading level="4">{status.content.displayName}</Heading>
            {loading && <Spinner size="sm" />}
          </Group>
        )}
        {current && status && (
          <Text color="fg.secondary" fontSize="sm">
            {editing ? (
              <>
                Editing variation <code>{editing}</code>
              </>
            ) : (
              'Editing the original page'
            )}
          </Text>
        )}

        {!contentRef && <Text color="fg.secondary">Open a page to set up its experiment.</Text>}
        {loadError && (
          <Alert intent={alertIntent(loadError)}>
            <Group flexDirection="column" gap="8">
              <Text fontSize="sm">{errorMessage(loadError)}</Text>
              {errorCode(loadError) === 'not_configured' && (
                <Text fontSize="sm">Fill these in on the Feature Experimentation app&apos;s settings page.</Text>
              )}
              {errorCode(loadError) !== 'unsupported_content' && (
                <Button onClick={onRefresh} size="sm">Retry</Button>
              )}
            </Group>
          </Alert>
        )}
        {contentRef && loading && !current && <Spinner />}

        {contentRef && status && current && !status.link && status.otherProjectLink && (
          <Alert intent="information">
            <Group flexDirection="column" gap="8">
              <Text fontSize="sm">
                This page was linked to <code>{status.otherProjectLink.flagKey}</code> in another Feature Experimentation
                project. The app now uses project {status.settings.projectId}, so that experiment isn&apos;t shown here.
              </Text>
              <Button
                loading={removingOther}
                onClick={() => {
                  setRemovingOther(true);
                  call(context, 'unlink', {content: contentRef, confirmRunning: true})
                    .then(setStatus, (e: unknown) => setLoadError(e as Error))
                    .finally(() => setRemovingOther(false));
                }}
                size="sm"
              >
                Remove it from this page
              </Button>
            </Group>
          </Alert>
        )}

        {contentRef && status && current && (
          status.link ? (
            <LinkedPanel
              audiences={audiences}
              context={context}
              contentRef={contentRef}
              createEvent={createEvent}
              events={events}
              loadAudiences={loadAudiences}
              loadEvents={loadEvents}
              onRefresh={onRefresh}
              onStatus={setStatus}
              status={status}
            />
          ) : (
            <CreatePanel
              audiences={audiences}
              context={context}
              contentRef={contentRef}
              createEvent={createEvent}
              events={events}
              key={`${status.content.key}:${status.content.locale}`}
              loadAudiences={loadAudiences}
              loadEvents={loadEvents}
              onRefresh={onRefresh}
              onStatus={setStatus}
              status={status}
            />
          )
        )}
      </Group>
    </Box>
  );
}

register((context) => (
  <AxiomProvider>
    <FxExperiment context={context} />
  </AxiomProvider>
));
