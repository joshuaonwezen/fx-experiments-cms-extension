import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, Envelope} from '../../shared/types';
import {CmsClient} from '../lib/cms';
import {ActionError} from '../lib/errors';
import {
  archiveFlag,
  createExperiment,
  deleteVariations,
  Deps,
  endExperiment,
  forgetLink,
  getStatus,
  linkExisting,
  listAudiences,
  listCmsFlags,
  listExperiments,
  removeVariations,
  setAudiences,
  setMetrics,
  setRoute,
  setRunning,
  setTraffic,
  syncVariations,
  unlink,
} from '../lib/experiments';
import {FxClient} from '../lib/fx';
import {ApiError} from '../lib/http';
import {loadConfig} from '../lib/settings';
import {isAction, PARSERS} from '../lib/validate';

interface RequestBody {
  action?: unknown;
  params?: unknown;
}

function ok<T>(result: T): Envelope<T> {
  return {ok: true, result};
}

function fail(error: string, message?: string): Envelope<never> {
  return message ? {ok: false, error, message} : {ok: false, error};
}

type Handlers = {[A in ActionName]: (deps: Deps, params: ActionParams[A]) => Promise<unknown>};

const HANDLERS: Handlers = {
  getStatus: (deps, p) => getStatus(deps, p.content),
  listEvents: (deps) => deps.fx.listEvents(),
  createEvent: (deps, p) => deps.fx.createEvent(p.key, p.name),
  listAudiences: (deps) => listAudiences(deps),
  listCmsFlags: (deps) => listCmsFlags(deps),
  createExperiment,
  syncVariations,
  removeVariations,
  setMetrics,
  setTraffic,
  setAudiences,
  setRunning,
  setRoute,
  linkExisting,
  unlink,
  endExperiment,
  deleteVariations,
  archiveFlag,
  listExperiments: (deps) => listExperiments(deps),
  forgetLink,
};

// Actions that change FX, the CMS or the link store. Each success is logged: the
// extension context carries no editor identity, so the log records what changed.
const READ_ONLY = new Set<ActionName>(['getStatus', 'listEvents', 'listAudiences', 'listCmsFlags', 'listExperiments']);

function auditFields(params: Record<string, unknown>) {
  const content = params.content as {key?: string; locale?: string} | undefined;
  return {
    content: content?.key ?? params.contentKey,
    locale: content?.locale ?? params.locale,
    flag: params.flagKey,
    running: params.running,
    winner: params.winner,
    shipVia: params.shipVia,
  };
}

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    if (!isAction(action)) return new App.Response(400, fail('unknown_action', action.slice(0, 64)));

    try {
      const raw = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const params = PARSERS[action](raw as Record<string, unknown>);

      const config = await loadConfig();
      if (!config.ok) {
        return new App.Response(412, fail('not_configured', `Missing in app settings: ${config.missing.join(', ')}.`));
      }
      const deps: Deps = {
        fx: new FxClient(config.fx),
        cms: new CmsClient(config.cms),
        profile: config.profile,
        allowDelete: config.allowDelete,
      };
      const handler = HANDLERS[action] as (deps: Deps, params: unknown) => Promise<unknown>;
      const result = await handler(deps, params);
      if (!READ_ONLY.has(action)) logger.info('audit', action, auditFields(params as Record<string, unknown>));
      return new App.Response(200, ok(result));
    } catch (error) {
      if (error instanceof ActionError) {
        return new App.Response(400, fail(error.code, error.message));
      }
      if (error instanceof ApiError) {
        logger.warn('Upstream API error', action, error.code, error.message);
        return new App.Response(502, fail(error.code, error.message));
      }
      logger.error('CmsUiExtension failure', action, error);
      return new App.Response(500, fail('internal_error'));
    }
  }
}
