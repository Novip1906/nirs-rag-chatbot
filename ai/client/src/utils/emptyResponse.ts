import { ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { getAllContentText } from './messages';

const SUBSTANTIVE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  ContentTypes.ERROR,
  ContentTypes.IMAGE_FILE,
  ContentTypes.IMAGE_URL,
  ContentTypes.VIDEO_URL,
]);

export function isEmptyAssistantResponse(message?: TMessage | null): boolean {
  if (message == null) {
    return false;
  }
  if ((message.attachments?.length ?? 0) > 0) {
    return false;
  }
  if (message.isCreatedByUser === true) {
    return false;
  }
  if (message.error === true) {
    return false;
  }
  if (message.unfinished === true) {
    return false;
  }
  if (message.finish_reason === 'incomplete') {
    return false;
  }
  const hasSubstantiveContentPart = message.content?.some(
    (part) => part != null && SUBSTANTIVE_CONTENT_TYPES.has(part.type),
  );
  if (hasSubstantiveContentPart === true) {
    return false;
  }

  return getAllContentText(message).trim().length === 0;
}

const AUTO_RETRY_PREFIX = 'corporate_empty_retry_';
const AUTO_RETRY_TTL_MS = 24 * 60 * 60 * 1000;

export function wasAutoRetried(key: string): boolean {
  try {
    const raw = localStorage.getItem(`${AUTO_RETRY_PREFIX}${key}`);
    if (raw == null) {
      return false;
    }
    const storedAt = Number(raw);
    if (!Number.isFinite(storedAt) || Date.now() - storedAt > AUTO_RETRY_TTL_MS) {
      localStorage.removeItem(`${AUTO_RETRY_PREFIX}${key}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markAutoRetried(key: string): void {
  try {
    localStorage.setItem(`${AUTO_RETRY_PREFIX}${key}`, String(Date.now()));
  } catch {
    return;
  }
}
