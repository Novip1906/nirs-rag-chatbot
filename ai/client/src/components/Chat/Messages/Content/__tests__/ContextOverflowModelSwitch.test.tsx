import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContentTypes, ErrorTypes } from 'librechat-data-provider';
import type { TMessage, TModelSpec } from 'librechat-data-provider';
import ContextOverflowModelSwitch from '../ContextOverflowModelSwitch';

const mockOnSelectSpec = jest.fn();
let mockSuggestion: TModelSpec | null = null;

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, options?: Record<string, unknown>): string => {
      if (key === 'com_ui_switch_to_model') {
        return `Switch to ${options?.[0]}`;
      }
      return key;
    },
  useGetConversation: () => () => null,
  useNewConvo: () => ({ newConversation: jest.fn() }),
  useModelSuggestion: () => mockSuggestion,
}));

jest.mock('~/Providers', () => ({
  useAssistantsMapContext: () => ({}),
}));

jest.mock('~/hooks/Input/useSelectMention', () => () => ({
  onSelectEndpoint: jest.fn(),
  onSelectSpec: mockOnSelectSpec,
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useGetStartupConfig: () => ({ data: { modelSpecs: { list: [] } } }),
}));

const makeSpec = (name: string, label: string): TModelSpec =>
  ({ name, label, preset: {} }) as TModelSpec;

const baseMessage = (overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: 'response-1',
    conversationId: 'convo-1',
    parentMessageId: 'user-1',
    isCreatedByUser: false,
    text: '',
    ...overrides,
  }) as TMessage;

const overflowMessage = (params: Record<string, unknown>): TMessage =>
  baseMessage({
    content: [
      {
        type: ContentTypes.ERROR,
        error: JSON.stringify({
          type: ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW,
          message: 'too big',
          errorCode: 'context_overflow',
          params,
        }),
      },
    ] as TMessage['content'],
  });

describe('ContextOverflowModelSwitch', () => {
  beforeEach(() => {
    mockOnSelectSpec.mockClear();
    mockSuggestion = null;
  });

  it('renders a button naming the suggested model and switches to it on click', () => {
    mockSuggestion = makeSpec('claude-sonnet-5', 'Claude Sonnet 5');
    const message = overflowMessage({ filename: 'report.pdf', requiredContextTokens: 1000000 });

    render(<ContextOverflowModelSwitch index={0} message={message} />);

    const button = screen.getByRole('button', { name: 'Switch to Claude Sonnet 5' });
    fireEvent.click(button);

    expect(mockOnSelectSpec).toHaveBeenCalledTimes(1);
    expect(mockOnSelectSpec).toHaveBeenCalledWith(mockSuggestion);
  });

  it('renders nothing when no stronger model is available', () => {
    mockSuggestion = null;
    const message = overflowMessage({ filename: 'report.pdf', requiredContextTokens: 1000000 });

    const { container } = render(<ContextOverflowModelSwitch index={0} message={message} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a message without a context-overflow error', () => {
    mockSuggestion = makeSpec('claude-sonnet-5', 'Claude Sonnet 5');
    const message = baseMessage({ messageId: 'response-2', content: [] });

    const { container } = render(<ContextOverflowModelSwitch index={0} message={message} />);

    expect(container).toBeEmptyDOMElement();
  });
});
