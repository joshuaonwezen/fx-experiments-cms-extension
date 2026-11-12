import type {CmsVariation} from '../../shared/types';
import {ApiError, requestJson} from './http';

const CMS_API = 'https://api.cms.optimizely.com';
const PAGE_SIZE = 100;
// A page re-seeded for months can have hundreds of versions; variations are found by
// scanning them, so cap the scan rather than let one call eat the function's budget.
const MAX_PAGES = 10;
const EXPIRY_BUFFER_MS = 30_000;

// Reads straight after a publish can still show the old status for a second or two (seen on
// joshCMS 2026-11-12), so the status is read back a few times before anything is concluded.
const CONFIRM_DELAYS_MS = [0, 500, 1000, 1500, 2000];
const PENDING = new Set(['draft', 'ready']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  routeSegment?: string;
  /** Absent on base versions. */
  variation?: string | null;
  /** PropertyData ({value: ...}) per property. Variation versions of an experience carry none. */
  properties?: Record<string, unknown>;
  composition?: Record<string, unknown>;
}

export type PublishOutcome = 'published' | 'awaiting_approval';

export interface CmsItem {
  key: string;
  contentType?: string;
  primaryLocale?: string | null;
  /** [''] for items without language versions (media, folders). */
  locales?: string[];
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
    return this.send<T>(label, path);
  }

  private async send<T>(label: string, path: string, init: RequestInit = {}): Promise<T | null> {
    return requestJson<T>('cms', label, `${CMS_API}${path}`, {
      ...init,
      headers: {Authorization: `Bearer ${await this.token()}`, ...init.headers},
    });
  }

  public async getItem(key: string): Promise<CmsItem | null> {
    try {
      return await this.get<CmsItem>('Get content', `/v1/content/${key}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  public async primaryLocale(key: string): Promise<string> {
    return (await this.getItem(key))?.primaryLocale || 'en';
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

  /**
   * Creates a draft of the item's base (no variation) in `locale` and returns its version.
   * The CMS copies the composition but NOT the properties into the new draft, so the
   * caller must patch every property it should keep.
   */
  public async createBaseDraft(
    key: string,
    locale: string,
    carry: {displayName?: string; routeSegment?: string},
  ): Promise<string> {
    // displayName + routeSegment ride along so the CMS doesn't re-derive the URL from the name.
    const created = await this.send<Partial<CmsVersion>>('Create draft', `/v1/content/${key}/versions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({locale, ...carry}),
    });
    if (created?.version && !created.variation) return String(created.version);
    // Some responses omit the version: take the newest base draft in this locale. Never
    // the global /versions list (it mixes languages) and never a variation's draft.
    const draft = (await this.listVersions(key, locale))
      .filter((v) => v.status === 'draft' && !v.variation)
      .sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!draft) throw new ApiError(502, 'cms_unavailable', `Create draft: no base draft of ${key} in ${locale} afterwards.`);
    return String(draft.version);
  }

  public async patchVersion(key: string, version: string, body: Record<string, unknown>): Promise<void> {
    await this.send('Update draft', `/v1/content/${key}/versions/${encodeURIComponent(version)}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/merge-patch+json'},
      body: JSON.stringify(body),
    });
  }

  /** Publishes the version, or reports that an approval workflow holds it for review. */
  public async publishVersion(key: string, version: string, confirmDelaysMs = CONFIRM_DELAYS_MS): Promise<PublishOutcome> {
    try {
      await this.send('Publish', `/v1/content/${key}/versions/${encodeURIComponent(version)}:publish`, {method: 'POST'});
    } catch (error) {
      // Instances with an approval workflow answer 400 "requires approval" and keep the draft.
      if (error instanceof ApiError && error.status === 400 && /requires approval/i.test(error.message)) {
        return 'awaiting_approval';
      }
      throw error;
    }
    for (const ms of confirmDelaysMs) {
      if (ms) await sleep(ms);
      const status = (await this.getVersion(key, version))?.status;
      // previous: published, and already replaced by a newer publish.
      if (status === 'published' || status === 'previous') return 'published';
      // Anything but a draft (inReview, say) means a workflow holds it.
      if (status && !PENDING.has(status)) return 'awaiting_approval';
    }
    // Still a draft after all the re-reads: say it waits, as before, rather than claim it is live.
    return 'awaiting_approval';
  }

  /** Permanently deletes one version. The CMS refuses the published version and a locale's only version. */
  public async deleteVersion(key: string, version: string): Promise<void> {
    await this.send('Delete version', `/v1/content/${key}/versions/${encodeURIComponent(version)}`, {method: 'DELETE'});
  }
}

const STATUS_RANK: Record<string, number> = {published: 3, draft: 2, previous: 1};

/**
 * The item's named variations, each with its best status (published > draft >
 * previous), the base display name, and whether the base (original page) is published.
 * Versions come newest first, so the first base version seen carries the current name.
 */
export function summarizeVersions(versions: CmsVersion[]): {
  variations: CmsVariation[];
  displayName: string;
  basePublished: boolean;
} {
  const best = new Map<string, string>();
  let displayName = '';
  let basePublished = false;
  for (const v of versions) {
    if (!v.variation) {
      if (!displayName && v.displayName) displayName = v.displayName;
      if (v.status === 'published') basePublished = true;
      continue;
    }
    const current = best.get(v.variation);
    if (!current || (STATUS_RANK[v.status] ?? 0) > (STATUS_RANK[current] ?? 0)) best.set(v.variation, v.status);
  }
  const variations = [...best.entries()]
    .map(([name, status]) => ({name, status}))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {variations, displayName, basePublished};
}
