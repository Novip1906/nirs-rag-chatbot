import { atomFamily } from 'recoil';

export const autoRetriedEmptyResponse = atomFamily<boolean, string>({
  key: 'autoRetriedEmptyResponse',
  default: false,
});

export const dismissedEmptyResponse = atomFamily<boolean, string>({
  key: 'dismissedEmptyResponse',
  default: false,
});

export interface PendingSpecRetry {
  spec: string;
  messageId: string;
  parentMessageId: string;
  requestedAt: number;
}

export const pendingSpecRetry = atomFamily<PendingSpecRetry | null, string>({
  key: 'pendingSpecRetry',
  default: null,
});
