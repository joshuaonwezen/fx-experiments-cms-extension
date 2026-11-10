import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {ActionName, ActionParams, AudienceOption, ContentRef, FxEvent, StatusResult} from '@shared/types';

export interface PanelProps {
  context: ExtensionContext;
  contentRef: ContentRef;
  status: StatusResult;
  events: FxEvent[] | null;
  loadEvents: () => Promise<void>;
  createEvent: (key: string, name: string) => Promise<FxEvent>;
  audiences: AudienceOption[] | null;
  loadAudiences: () => Promise<void>;
  onStatus: (status: StatusResult) => void;
  onRefresh: () => void;
}

/** The actions that answer with a fresh StatusResult. */
export type StatusAction = Exclude<
  ActionName,
  'listEvents' | 'createEvent' | 'listExperiments' | 'listAudiences' | 'listCmsFlags' | 'forgetLink'
>;

/** Runs one action and applies the status it returns (errors and confirmations are handled by the caller). */
export type Run = <A extends StatusAction>(action: A, params: ActionParams[A]) => Promise<void>;
