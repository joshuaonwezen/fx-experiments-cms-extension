import {Alert, AxiomProvider, Box, Button, Group, Spinner, Text} from '@optiaxiom/react';
import {register, type ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {CmsFlagOption, ExperimentLink, ExperimentsOverview} from '@shared/types';
import {useCallback, useEffect, useState} from 'react';

import {call, errorMessage} from '../common/api';
import {OpenLink} from '../common/OpenLink';
import {formatPercent, StatusBadge} from '../common/StatusBadge';
import {Chip, Code, count, Icon, STYLE, type ChipState, type IconName} from '../common/ui';

const rowKey = (link: ExperimentLink) => `${link.contentKey}:${link.locale}`;

function endedText(link: ExperimentLink): string {
  const ended = link.conclusion!;
  if (!ended.winner) return 'No winner';
  if (!ended.shipVia) return 'Original page won';
  if (ended.shipVia === 'fx') return `${ended.winner} won · served by FX`;
  return ended.promotion === 'published' ? `${ended.winner} won · now the page` : `${ended.winner} won · awaiting approval`;
}

function FxExperiments({context}: {context: ExtensionContext}) {
  const [overview, setOverview] = useState<ExperimentsOverview | null>(null);
  const [unlinked, setUnlinked] = useState<CmsFlagOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await call(context, 'listExperiments', {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // Secondary: flags FX has that no page links to.
    call(context, 'listCmsFlags', {}).then(
      (flags) => setUnlinked(flags.filter((f) => !f.linked)),
      () => setUnlinked(null),
    );
  }, [context]);

  useEffect(() => {
    void context.extension.setReady();
    void load();
  }, [context, load]);

  const rowAction = async (link: ExperimentLink, action: () => Promise<unknown>) => {
    setBusyRow(rowKey(link));
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(`${link.displayName}: ${errorMessage(e)}`);
    } finally {
      setBusyRow(null);
    }
  };

  const setRunning = (link: ExperimentLink, running: boolean) =>
    rowAction(link, () => call(context, 'setRunning', {content: {key: link.contentKey, locale: link.locale}, running}));
  const forget = (link: ExperimentLink) =>
    rowAction(link, async () => setOverview(await call(context, 'forgetLink', {contentKey: link.contentKey, locale: link.locale})));

  const rows = overview?.rows ?? null;
  const otherProject = overview?.otherProject ?? [];
  const running = rows?.filter((r) => r.rule?.running && !r.link.conclusion).length ?? 0;

  // Links to experiments in another FX project (the SDK key changed since): not this
  // project's experiments, so they're hidden and can be removed in one go.
  const forgetOtherProject = async () => {
    setLoading(true);
    setError(null);
    try {
      let next: ExperimentsOverview | null = null;
      for (const link of otherProject) {
        next = await call(context, 'forgetLink', {contentKey: link.contentKey, locale: link.locale});
      }
      if (next) setOverview(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const paused = rows?.filter((r) => r.rule && !r.rule.running && !r.link.conclusion).length ?? 0;
  const ended = rows?.filter((r) => r.link.conclusion).length ?? 0;
  const tiles: Array<{label: string; n: number; state: ChipState; icon: IconName}> = [
    {label: 'Linked pages', n: rows?.length ?? 0, state: 'draft', icon: 'arrow'},
    {label: 'Running', n: running, state: 'good', icon: 'play'},
    {label: 'Paused or not started', n: paused, state: 'warn', icon: 'pause'},
    {label: 'Ended', n: ended, state: 'neutral', icon: 'check'},
  ];

  return (
    <Box className="ui" p="24">
      <style>{STYLE}</style>
      <Group flexDirection="column" gap="20">
        <Group alignItems="start" gap="16" justifyContent="space-between">
          <Group flexDirection="column" gap="4">
            <Text fontSize="lg" fontWeight="600">
              {rows ? `${count(rows.length, 'page')} in an experiment` : 'Experiments'}
            </Text>
            <Text color="fg.secondary" fontSize="sm">
              Pages whose CMS variations are in a Feature Experimentation A/B test
              {overview ? ` · project ${overview.projectId}, ${overview.environmentKey}` : ''}.
            </Text>
          </Group>
          <Button appearance="subtle" loading={loading} onClick={() => void load()} size="sm">
            Refresh
          </Button>
        </Group>

        {error && <Alert intent="danger">{error}</Alert>}
        {otherProject.length > 0 && (
          <Alert intent="information">
            <Group alignItems="center" gap="8" justifyContent="space-between">
              <Text fontSize="sm">
                {otherProject.length === 1 ? '1 page is' : `${otherProject.length} pages are`} still linked to an
                experiment in another Feature Experimentation project, so {otherProject.length === 1 ? 'it is' : 'they are'}{' '}
                hidden here.
              </Text>
              <Button loading={loading} onClick={() => void forgetOtherProject()} size="sm">
                Remove {otherProject.length === 1 ? 'it' : 'them'}
              </Button>
            </Group>
          </Alert>
        )}
        {!rows && !error && (
          <Group gap="8">
            <Spinner size="sm" />
            <Text color="fg.secondary" fontSize="sm">
              Reading every linked experiment…
            </Text>
          </Group>
        )}
        {rows && rows.length === 0 && (
          <Alert intent="information">
            <Text fontSize="sm">
              No experiments yet. Open a page that has variations and use the Feature Experimentation panel in the editor
              sidebar to create one.
            </Text>
          </Alert>
        )}

        {rows && rows.length > 0 && (
          <>
            <div className="ui-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))'}}>
              {tiles.map((t) => (
                <div className="ui-tile" key={t.label}>
                  <div className="ui-tile-label">
                    <span className="ui-chip" data-state={t.state} style={{padding: 2}}>
                      <Icon name={t.icon} size={12} />
                    </span>
                    {t.label}
                  </div>
                  <div className="ui-tile-value">{t.n.toLocaleString('en-GB')}</div>
                </div>
              ))}
            </div>

            <div style={{overflowX: 'auto'}}>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Flag and route</th>
                    <th>Status</th>
                    <th>Split</th>
                    <th>Primary metric</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({link, rule, error: rowError}) => (
                    <tr key={rowKey(link)}>
                      <td style={{minWidth: 150}}>
                        <div style={{fontWeight: 500}}>{link.displayName}</div>
                        <div className="ui-faint ui-small">{link.locale}</div>
                      </td>
                      <td style={{minWidth: 220}}>
                        <Group alignItems="start" flexDirection="column" gap="4">
                          <Code wrap>{link.flagKey}</Code>
                          <span className="ui-faint ui-small">
                            {link.environmentKey} · on {rule?.route || link.route || 'every page'}
                          </span>
                        </Group>
                      </td>
                      <td style={{minWidth: 150}}>
                        {link.conclusion ? (
                          <Group alignItems="start" flexDirection="column" gap="4">
                            <Chip icon="check" label="Ended" state="draft" />
                            <span className="ui-muted ui-small">{endedText(link)}</span>
                          </Group>
                        ) : rule ? (
                          <StatusBadge running={rule.running} status={rule.status} />
                        ) : (
                          <Group alignItems="start" flexDirection="column" gap="4">
                            <Chip label="Unavailable" state="bad" />
                            <span className="ui-muted ui-small">{rowError}</span>
                          </Group>
                        )}
                      </td>
                      <td style={{minWidth: 170}}>
                        {rule && (
                          <Group alignItems="start" flexDirection="column" gap="2">
                            {rule.variations.map((v) => (
                              <span className="ui-small" key={v.key}>
                                {v.key === 'control' ? 'Original page' : v.key}{' '}
                                <span className="ui-faint ui-num">{formatPercent(v.percent)}</span>
                              </span>
                            ))}
                            {rule.trafficPercent < 100 && (
                              <span className="ui-faint ui-small">{formatPercent(rule.trafficPercent)} of visitors enter</span>
                            )}
                          </Group>
                        )}
                      </td>
                      <td style={{minWidth: 140}}>
                        <div>{rule?.metrics[0]?.title ?? '–'}</div>
                        {rule && rule.metrics.length > 1 && (
                          <div className="ui-faint ui-small">+{rule.metrics.length - 1} more</div>
                        )}
                      </td>
                      <td>
                        <Group gap="4" justifyContent="end" style={{flexWrap: 'nowrap'}}>
                          {rule && !link.conclusion && (
                            <Button
                              loading={busyRow === rowKey(link)}
                              onClick={() => void setRunning(link, !rule.running)}
                              size="sm"
                            >
                              {rule.running ? 'Pause' : 'Start'}
                            </Button>
                          )}
                          {rule?.resultsUrl && (
                            <OpenLink appearance="subtle" size="sm" url={rule.resultsUrl}>
                              Results
                            </OpenLink>
                          )}
                          {rule && (
                            <OpenLink appearance="subtle" size="sm" url={rule.flagUrl}>
                              Flag
                            </OpenLink>
                          )}
                          {!rule && rowError && (
                            <Button appearance="subtle" loading={busyRow === rowKey(link)} onClick={() => void forget(link)} size="sm">
                              Remove
                            </Button>
                          )}
                        </Group>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {unlinked && unlinked.length > 0 && (
          <div className="ui-card">
            <div className="ui-card-title">
              <span>CMS flags no page links to</span>
              <span className="ui-faint ui-small">{count(unlinked.length, 'flag')}</span>
            </div>
            <span className="ui-muted ui-small">
              These flags can serve CMS variations but aren&apos;t linked to a page here. Link one from a page&apos;s Feature
              Experimentation panel to manage it from the editor.
            </span>
            <div className="ui-chips">
              {unlinked.map((f) => (
                <Code key={f.flagKey}>{f.flagKey}</Code>
              ))}
            </div>
          </div>
        )}
      </Group>
    </Box>
  );
}

register((context) => (
  <AxiomProvider>
    <FxExperiments context={context} />
  </AxiomProvider>
));
