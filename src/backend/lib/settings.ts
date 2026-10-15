import {storage} from '@zaiusinc/app-sdk';

import {parseAudienceIds} from '../../shared/experiment';
import type {CmsConfig} from './cms';
import type {FxConfig} from './fx';

// Section keys match forms/settings.yml.
// Type aliases, not interfaces: the settings store requires an index-signature-compatible shape.
export type FxSettings = {
  apiToken?: string;
  projectId?: string;
  environmentKey?: string;
  audienceIds?: string;
};

export type CmsSettings = {
  clientId?: string;
  clientSecret?: string;
};

export const DEFAULT_ENVIRONMENT = 'production';

export type LoadedConfig = {ok: true; fx: FxConfig; cms: CmsConfig} | {ok: false; missing: string[]};

export function toFxConfig(s: FxSettings): FxConfig {
  return {
    token: s.apiToken?.trim() ?? '',
    projectId: s.projectId?.trim() ?? '',
    environmentKey: s.environmentKey?.trim() || DEFAULT_ENVIRONMENT,
    audienceIds: parseAudienceIds(s.audienceIds),
  };
}

export async function loadConfig(): Promise<LoadedConfig> {
  const [fxSettings, cmsSettings] = await Promise.all([
    storage.settings.get<FxSettings>('fx'),
    storage.settings.get<CmsSettings>('cms'),
  ]);
  const fx = toFxConfig(fxSettings);
  const cms = {clientId: cmsSettings.clientId?.trim() ?? '', clientSecret: cmsSettings.clientSecret?.trim() ?? ''};

  const missing = [
    !fx.token && 'FX personal access token',
    !fx.projectId && 'FX project ID',
    !cms.clientId && 'CMS client ID',
    !cms.clientSecret && 'CMS client secret',
  ].filter((m): m is string => Boolean(m));

  return missing.length > 0 ? {ok: false, missing} : {ok: true, fx, cms};
}
