import type {ExtensionContext} from '@optimizely/cms-extensibility-sdk';
import type {ContentRef, FxEvent, StatusResult} from '@shared/types';

export interface PanelProps {
  context: ExtensionContext;
  contentRef: ContentRef;
  status: StatusResult;
  events: FxEvent[] | null;
  loadEvents: () => Promise<void>;
  createEvent: (key: string, name: string) => Promise<FxEvent>;
  onStatus: (status: StatusResult) => void;
  onRefresh: () => void;
}
