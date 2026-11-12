import {afterEach, describe, expect, it, vi} from 'vitest';

import {CmsClient} from './cms';

const KEY = '0123456789abcdef0123456789abcdef';

/** Answers the CMS API from a table of `METHOD path` -> [status, body]; records every call. */
function stubCms(routes: Record<string, Array<[number, unknown]>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === '/oauth/token') return new Response(JSON.stringify({access_token: 't', expires_in: 3600}));
      const route = `${init.method ?? 'GET'} ${path}`;
      calls.push(route);
      const answer = routes[route]?.shift();
      if (!answer) return new Response('not stubbed', {status: 500});
      return new Response(answer[1] === null ? '' : JSON.stringify(answer[1]), {status: answer[0]});
    }),
  );
  return calls;
}

const client = () => new CmsClient({clientId: 'id', clientSecret: 'secret'});
const version = (status: string) => [200, {key: KEY, version: '7', locale: 'en', status}] as [number, unknown];

describe('CmsClient.publishVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-reads the status after publishing', async () => {
    const calls = stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [version('published')],
    });
    expect(await client().publishVersion(KEY, '7')).toBe('published');
    expect(calls).toEqual([`POST /v1/content/${KEY}/versions/7:publish`, `GET /v1/content/${KEY}/versions/7`]);
  });

  it('waits out a read that still shows the draft right after publishing', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [version('draft'), version('published')],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0, 0])).toBe('published');
  });

  it('reads a review status as waiting for approval', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [version('inReview')],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0])).toBe('awaiting_approval');
  });

  it('still says waiting when the draft never shows as published', async () => {
    stubCms({
      [`POST /v1/content/${KEY}/versions/7:publish`]: [[200, null]],
      [`GET /v1/content/${KEY}/versions/7`]: [version('draft'), version('draft')],
    });
    expect(await client().publishVersion(KEY, '7', [0, 0])).toBe('awaiting_approval');
  });

  it('treats "requires approval" as waiting for a reviewer', async () => {
    stubCms({[`POST /v1/content/${KEY}/versions/7:publish`]: [[400, {detail: 'Publishing requires approval.'}]]});
    expect(await client().publishVersion(KEY, '7')).toBe('awaiting_approval');
  });
});
