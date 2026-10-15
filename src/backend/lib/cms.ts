import type {CmsVariation} from '../../shared/types';
import {ApiError, requestJson} from './http';

const CMS_API = 'https://api.cms.optimizely.com';
const PAGE_SIZE = 100;
// A page re-seeded for months can have hundreds of versions; variations are found by
// scanning them, so cap the scan rather than let one call eat the function's budget.
const MAX_PAGES = 10;
const EXPIRY_BUFFER_MS = 30_000;

export interface CmsConfig {
  clientId: string;
  clientSecret: string;
}

export interface CmsVersion {
  key: string;
  version: string;
  locale: string;
  status: string;
  displayName?: string;
  /** Absent on base versions. */
  variation?: string | null;
}

// Module scope survives warm invocations of the function.
let tokenCache: {clientId: string; token: string; expiresAt: number} | null = null;

export class CmsClient {
  private readonly cfg: CmsConfig;

  public constructor(cfg: CmsConfig) {
    this.cfg = cfg;
  }

  public async token(): Promise<string> {
    if (tokenCache && tokenCache.clientId === this.cfg.clientId && tokenCache.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return tokenCache.token;
    }
    const body = await requestJson<{access_token: string; expires_in: number}>('cms', 'CMS token', `${CMS_API}/oauth/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!body?.access_token) throw new ApiError(502, 'cms_unavailable', 'CMS token: no access_token in response');
    tokenCache = {clientId: this.cfg.clientId, token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
    return body.access_token;
  }

  private async get<T>(label: string, path: string): Promise<T | null> {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      headers: {Authorization: `Bearer ${await this.token()}`},
    });
  }

  public async primaryLocale(key: string): Promise<string> {
    const item = await this.get<{primaryLocale?: string}>('Get content', `/v1/content/${key}`);
    return item?.primaryLocale ?? 'en';
  }

  /** Every version of the item in `locale`, newest first (capped at MAX_PAGES pages). */
  public async listVersions(key: string, locale: string): Promise<CmsVersion[]> {
    const versions: CmsVersion[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const page = await this.get<{items?: CmsVersion[]}>(
        'List versions',
        `/v1/content/${key}/locales/${encodeURIComponent(locale)}?pageSize=${PAGE_SIZE}&pageIndex=${pageIndex}`,
      );
      const items = page?.items ?? [];
      versions.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return versions;
  }

  public async getVersion(key: string, version: string): Promise<CmsVersion | null> {
    try {
      return await this.get<CmsVersion>('Get version', `/v1/content/${key}/versions/${encodeURIComponent(version)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
}

const STATUS_RANK: Record<string, number> = {published: 3, draft: 2, previous: 1};

/**
 * The item's named variations, each with its best status (published > draft >
 * previous), plus the base display name. Versions come newest first, so the first
 * base version seen carries the current name.
 */
export function summarizeVersions(versions: CmsVersion[]): {variations: CmsVariation[]; displayName: string} {
  const best = new Map<string, string>();
  let displayName = '';
  for (const v of versions) {
    if (!v.variation) {
      if (!displayName && v.displayName) displayName = v.displayName;
      continue;
    }
    const current = best.get(v.variation);
    if (!current || (STATUS_RANK[v.status] ?? 0) > (STATUS_RANK[current] ?? 0)) best.set(v.variation, v.status);
  }
  const variations = [...best.entries()]
    .map(([name, status]) => ({name, status}))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {variations, displayName};
}
