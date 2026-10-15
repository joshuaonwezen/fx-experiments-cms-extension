import {storage, type KVHash} from '@zaiusinc/app-sdk';

import type {ExperimentLink} from '../../shared/types';

// One hash for the whole install (installs are per CMS instance): field per
// content item + locale → the flag/rule it's linked to. A single row keeps the
// Experiments view to one read; a CMS instance has dozens of experiments, not
// thousands.
const LINKS_KEY = 'experiment_links';

function field(contentKey: string, locale: string): string {
  return `${contentKey}:${locale}`;
}

export async function getLink(contentKey: string, locale: string): Promise<ExperimentLink | null> {
  const id = field(contentKey, locale);
  const row = await storage.kvStore.get<KVHash>(LINKS_KEY, [id]);
  const link = row[id] as unknown as ExperimentLink | undefined;
  return link?.flagKey ? link : null;
}

export async function saveLink(link: ExperimentLink): Promise<void> {
  const id = field(link.contentKey, link.locale);
  await storage.kvStore.patch<KVHash>(LINKS_KEY, {[id]: link} as unknown as KVHash);
}

export async function removeLink(contentKey: string, locale: string): Promise<void> {
  await storage.kvStore.delete(LINKS_KEY, [field(contentKey, locale)]);
}

export async function listLinks(): Promise<ExperimentLink[]> {
  const row = await storage.kvStore.get<KVHash>(LINKS_KEY);
  return Object.values(row)
    .map((v) => v as unknown as ExperimentLink)
    .filter((l) => l?.flagKey)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
