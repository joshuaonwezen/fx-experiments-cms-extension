import * as App from '@zaiusinc/app-sdk';
import {logger} from '@zaiusinc/app-sdk';

import type {ActionName, ActionParams, Envelope} from '../../shared/types';
import {CmsClient} from '../lib/cms';
import {
  ActionError,
  createExperiment,
  Deps,
  getStatus,
  linkExisting,
  listExperiments,
  setMetrics,
  setRoute,
  setRunning,
  syncVariations,
  unlink,
} from '../lib/experiments';
import {FxClient} from '../lib/fx';
import {ApiError} from '../lib/http';
import {loadConfig} from '../lib/settings';

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

type Handler = (deps: Deps, params: never) => Promise<unknown>;

const HANDLERS: Record<ActionName, Handler> = {
  getStatus: (deps, p: ActionParams['getStatus']) => getStatus(deps, p.content),
  listEvents: (deps) => deps.fx.listEvents(),
  createEvent: (deps, p: ActionParams['createEvent']) => deps.fx.createEvent(p.key, p.name || p.key),
  createExperiment: (deps, p: ActionParams['createExperiment']) => createExperiment(deps, p),
  syncVariations: (deps, p: ActionParams['syncVariations']) => syncVariations(deps, p),
  setMetrics: (deps, p: ActionParams['setMetrics']) => setMetrics(deps, p),
  setRunning: (deps, p: ActionParams['setRunning']) => setRunning(deps, p),
  setRoute: (deps, p: ActionParams['setRoute']) => setRoute(deps, p),
  linkExisting: (deps, p: ActionParams['linkExisting']) => linkExisting(deps, p),
  unlink: (deps, p: ActionParams['unlink']) => unlink(deps, p),
  listExperiments: (deps) => listExperiments(deps),
};

export class CmsUiExtension extends App.Function {
  public async perform(): Promise<App.Response> {
    const body = (this.request.bodyJSON ?? {}) as RequestBody;
    const action = typeof body.action === 'string' ? body.action : '';
    const params = (body.params ?? {}) as never;

    const handler = HANDLERS[action as ActionName];
    if (!handler) return new App.Response(400, fail('unknown_action', action));

    try {
      const config = await loadConfig();
      if (!config.ok) {
        return new App.Response(412, fail('not_configured', `Missing in app settings: ${config.missing.join(', ')}.`));
      }

      const deps: Deps = {fx: new FxClient(config.fx), cms: new CmsClient(config.cms)};
      return new App.Response(200, ok(await handler(deps, params)));
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
