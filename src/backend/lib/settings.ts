import {logger, storage, ValueHash} from '@zaiusinc/app-sdk';

import {parseAudienceIds} from '../../shared/experiment';
import {toSiteProfile, type SiteProfile, type SiteSettings} from '../../shared/profile';
import type {CmsConfig} from './cms';
import type {FxConfig} from './fx';

// Section keys match forms/settings.yml.
// Type aliases, not interfaces: the settings store requires an index-signature-compatible shape.
export type FxSettings = {
  apiToken?: string;
  /** The site's SDK key. Project and environment are read from its datafile on save. */
  sdkKey?: string;
  projectId?: string;
  environmentKey?: string;
  audienceIds?: string;
};

export type CmsSettings = {
  clientId?: string;
  clientSecret?: string;
  /** Lets "End experiment" delete the test's CMS variations. Off unless an admin turns it on. */
  allowDelete?: boolean;
};

export type {SiteSettings};

export const DEFAULT_ENVIRONMENT = 'production';

export type LoadedConfig =
  | {ok: true; fx: FxConfig; cms: CmsConfig; profile: SiteProfile; allowDelete: boolean}
  | {ok: false; missing: string[]};

export function toFxConfig(s: FxSettings): FxConfig {
  return {
    token: s.apiToken?.trim() ?? '',
    projectId: s.projectId?.trim() ?? '',
    environmentKey: s.environmentKey?.trim() || DEFAULT_ENVIRONMENT,
    sdkKey: s.sdkKey?.trim() ?? '',
    audienceIds: parseAudienceIds(s.audienceIds),
  };
}

/**
 * One settings section, or {} when the store can't be read. On a CMS-scoped install that has
 * never saved its settings, the production store throws "Failed to get value at
 * app-data/<install>/settings" instead of returning {}.
 */
export async function readSection<T extends ValueHash>(section: string): Promise<T> {
  try {
    return await storage.settings.get<T>(section);
  } catch (error) {
    logger.warn('Could not read settings section', section, error);
    return {} as T;
  }
}

export async function loadConfig(): Promise<LoadedConfig> {
  const [fxSettings, cmsSettings, siteSettings] = await Promise.all([
    readSection<FxSettings>('fx'),
    readSection<CmsSettings>('cms'),
    readSection<SiteSettings>('site'),
  ]);
  const fx = toFxConfig(fxSettings);
  const cms = {clientId: cmsSettings.clientId?.trim() ?? '', clientSecret: cmsSettings.clientSecret?.trim() ?? ''};

  // Installs saved before the SDK key existed still have a project ID; they keep working,
  // without the datafile-based checks, until the settings are saved again.
  const missing = [
    !fx.token && 'FX personal access token',
    !fx.projectId && 'the site\'s SDK key',
    !cms.clientId && 'CMS client ID',
    !cms.clientSecret && 'CMS client secret',
  ].filter((m): m is string => Boolean(m));

  if (missing.length > 0) return {ok: false, missing};
  return {ok: true, fx, cms, profile: toSiteProfile(siteSettings), allowDelete: cmsSettings.allowDelete === true};
}
