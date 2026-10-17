import { ContentTypes } from 'librechat-data-provider';
import type { TMessage, TAttachment, TMessageContentParts } from 'librechat-data-provider';
import { isEmptyAssistantResponse, markAutoRetried, wasAutoRetried } from '../emptyResponse';

const baseMessage = (overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: 'response-1',
    conversationId: 'convo-1',
    parentMessageId: 'user-1',
    isCreatedByUser: false,
    text: '',
    ...overrides,
  }) as TMessage;

const toolCallPart = (): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    tool_call: { id: 't1', name: 'web_search', args: '{}', output: 'ok' },
  }) as unknown as TMessageContentParts;

const textPart = (value: string): TMessageContentParts =>
  ({ type: ContentTypes.TEXT, text: { value } }) as unknown as TMessageContentParts;

const errorPart = (): TMessageContentParts =>
  ({ type: ContentTypes.ERROR, text: 'boom' }) as unknown as TMessageContentParts;

const attachment = (): TAttachment => ({ file_id: 'file-1' }) as unknown as TAttachment;

describe('isEmptyAssistantResponse', () => {
  it('treats an empty text and empty content array as empty', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', content: [] }))).toBe(true);
  });

  it('treats content with only a tool_call part as empty', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', content: [toolCallPart()] }))).toBe(
      true,
    );
  });

  it('is not empty when a content part carries text in text.value', () => {
    expect(
      isEmptyAssistantResponse(baseMessage({ text: '', content: [textPart('Hello there')] })),
    ).toBe(false);
  });

  it('is not empty when message.text itself is non-empty', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: 'Hello there' }))).toBe(false);
  });

  it('is not empty when unfinished is true, even with empty text', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', unfinished: true }))).toBe(false);
  });

  it('is not empty when error is true', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', error: true }))).toBe(false);
  });

  it('is not empty for a user message', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', isCreatedByUser: true }))).toBe(false);
  });

  it('is not empty when content carries an ERROR part', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', content: [errorPart()] }))).toBe(false);
  });

  it('treats text made only of whitespace as empty', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '   \n\t  ' }))).toBe(true);
  });

  it('returns false for a null or undefined message', () => {
    expect(isEmptyAssistantResponse(null)).toBe(false);
    expect(isEmptyAssistantResponse(undefined)).toBe(false);
  });

  it('is not empty when the message carries an attachment, even with empty text', () => {
    expect(
      isEmptyAssistantResponse(baseMessage({ text: '', content: [], attachments: [attachment()] })),
    ).toBe(false);
  });

  it('is not empty when finish_reason is incomplete, even with empty text', () => {
    expect(isEmptyAssistantResponse(baseMessage({ text: '', finish_reason: 'incomplete' }))).toBe(
      false,
    );
  });
});

describe('wasAutoRetried / markAutoRetried', () => {
  const key = 'convo-1|user-1';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when no retry was recorded for the key', () => {
    expect(wasAutoRetried(key)).toBe(false);
  });

  it('returns true after the key was marked as retried', () => {
    markAutoRetried(key);
    expect(wasAutoRetried(key)).toBe(true);
  });

  it('treats a record older than 24 hours as expired and clears it', () => {
    const staleTimestamp = Date.now() - (24 * 60 * 60 * 1000 + 1);
    localStorage.setItem(`corporate_empty_retry_${key}`, String(staleTimestamp));

    expect(wasAutoRetried(key)).toBe(false);
    expect(localStorage.getItem(`corporate_empty_retry_${key}`)).toBeNull();
  });

  it('does not throw and returns/exits safely when localStorage access fails', () => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };

    expect(wasAutoRetried(key)).toBe(false);
    expect(() => markAutoRetried(key)).not.toThrow();

    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
  });
});
