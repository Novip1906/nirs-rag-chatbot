import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { RecoilRoot, type MutableSnapshot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ContentTypes,
  EModelEndpoint,
  type TConversation,
  type TMessage,
} from 'librechat-data-provider';
import { startupConfigKey } from '~/data-provider/Endpoints/queries';
import { hasCopyableText } from '~/hooks/Messages/useCopyToClipboard';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import store from '~/store';

/**
 * `MessageAudio` renders nothing without a configured speech engine, so a bare
 * "the button is absent" assertion would pass whether or not the switch works.
 * Standing in for it makes the switch the only thing under test.
 */
jest.mock('~/components/Chat/Messages/MessageAudio', () => ({
  __esModule: true,
  default: () => <button type="button" data-testid="read-aloud-stub" />,
}));

const conversation = {
  conversationId: 'convo-1',
  endpoint: EModelEndpoint.agents,
  title: 'Test',
} as TConversation;

const userMessage = {
  messageId: 'user-1',
  conversationId: 'convo-1',
  parentMessageId: null,
  isCreatedByUser: true,
  text: 'tell me a long story',
} as TMessage;

function renderHoverButtons({
  isSubmitting,
  message = userMessage,
  conversation: targetConversation = conversation,
  isLast = false,
  latestMessageId = 'assistant-1',
  getCanCopy = () => hasCopyableText({ text: message.text, content: message.content }),
  handleFeedback,
  interfaceConfig,
  readAloudOn = false,
}: {
  isSubmitting: boolean;
  message?: TMessage;
  conversation?: TConversation;
  isLast?: boolean;
  latestMessageId?: string;
  getCanCopy?: () => boolean;
  handleFeedback?: () => void;
  interfaceConfig?: Record<string, boolean>;
  readAloudOn?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  if (interfaceConfig != null) {
    queryClient.setQueryData(startupConfigKey(false), { interface: interfaceConfig });
  }

  const initializeState = ({ set }: MutableSnapshot) => set(store.textToSpeech, readAloudOn);

  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot initializeState={initializeState}>
        <MemoryRouter>
          <HoverButtons
            index={0}
            isLast={isLast}
            isEditing={false}
            message={message}
            conversation={targetConversation}
            isSubmitting={isSubmitting}
            enterEdit={jest.fn()}
            regenerate={jest.fn()}
            handleContinue={jest.fn()}
            copyToClipboard={jest.fn()}
            getCanCopy={getCanCopy}
            latestMessageId={latestMessageId}
            handleFeedback={handleFeedback}
          />
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>,
  );

  return container;
}

describe('HoverButtons edit affordance', () => {
  it('keeps edit available on an earlier message while a generation is in flight', () => {
    const container = renderHoverButtons({ isSubmitting: true });
    const editButton = container.querySelector<HTMLButtonElement>(`#edit-${userMessage.messageId}`);

    expect(editButton).not.toBeNull();
    expect(editButton).toBeEnabled();
    expect(editButton).not.toHaveClass('pointer-events-none', 'opacity-0', '!opacity-0');
  });

  it('reveals on row hover once the generation settles', () => {
    const container = renderHoverButtons({ isSubmitting: false });
    const editButton = container.querySelector<HTMLButtonElement>(`#edit-${userMessage.messageId}`);

    expect(editButton).not.toBeNull();
    expect(editButton).toBeEnabled();
    expect(editButton).toHaveClass('group-hover:opacity-100');
    expect(editButton).not.toHaveClass('pointer-events-none', 'opacity-0', '!opacity-0');
  });

  it('offers no actions at all on the actively streaming assistant message', () => {
    const assistantMessage = {
      ...userMessage,
      messageId: 'assistant-1',
      isCreatedByUser: false,
      text: 'Partial response',
    } as TMessage;

    const container = renderHoverButtons({
      isSubmitting: true,
      message: assistantMessage,
      isLast: true,
      latestMessageId: assistantMessage.messageId,
    });

    /** Copying, forking or editing half a sentence all act on text that is about
     *  to change, so the response carries nothing until it settles. */
    expect(container.querySelector(`#edit-${assistantMessage.messageId}`)).toBeNull();
    expect(screen.queryByTestId('copy-response-button')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers copy for an error response', () => {
    const errorMessage = {
      ...userMessage,
      messageId: 'assistant-error',
      isCreatedByUser: false,
      error: true,
      text: 'Tool execution failed',
    } as TMessage;

    renderHoverButtons({
      isSubmitting: false,
      message: errorMessage,
      isLast: true,
      latestMessageId: errorMessage.messageId,
    });

    expect(screen.getByTestId('copy-response-button')).toBeEnabled();
  });

  it('disables copy when the response serializes to nothing', () => {
    const errorPartMessage = {
      ...userMessage,
      messageId: 'assistant-error-part',
      isCreatedByUser: false,
      error: true,
      text: '',
      content: [{ type: ContentTypes.ERROR, error: 'Deployment lookup failed' }],
    } as TMessage;

    renderHoverButtons({
      isSubmitting: false,
      message: errorPartMessage,
      isLast: true,
      latestMessageId: errorPartMessage.messageId,
    });

    expect(screen.getByTestId('copy-response-button')).toBeDisabled();
  });

  it('never inspects a response that is still streaming', () => {
    const streamingMessage = {
      ...userMessage,
      messageId: 'assistant-1',
      isCreatedByUser: false,
      text: 'partial resp',
    } as TMessage;
    const getCanCopy = jest.fn(() => true);

    renderHoverButtons({
      isSubmitting: true,
      message: streamingMessage,
      isLast: true,
      latestMessageId: streamingMessage.messageId,
      getCanCopy,
    });

    expect(screen.queryByTestId('copy-response-button')).toBeNull();
    expect(getCanCopy).not.toHaveBeenCalled();
  });

  it('keeps child-thread history readable without model-turn controls', () => {
    const assistantMessage = {
      ...userMessage,
      messageId: 'assistant-child',
      isCreatedByUser: false,
      text: 'Completed child result',
    } as TMessage;
    const childConversation = {
      ...conversation,
      conversationId: 'child-thread',
      subagentThread: {
        rootConversationId: 'parent-thread',
        parentConversationId: 'parent-thread',
        parentMessageId: 'parent-message',
        parentToolCallId: 'parent-tool-call',
        parentAgentId: 'parent-agent',
        subagentType: 'researcher',
        subagentKind: 'agent',
        depth: 1,
      },
    } as TConversation;

    const container = renderHoverButtons({
      isSubmitting: false,
      message: assistantMessage,
      conversation: childConversation,
      isLast: true,
      latestMessageId: assistantMessage.messageId,
    });

    expect(screen.getByTestId('copy-response-button')).toBeEnabled();
    expect(container.querySelector(`#edit-${assistantMessage.messageId}`)).toBeNull();
    expect(screen.queryByTestId('regenerate-generation-button')).toBeNull();
    expect(screen.queryByTestId('continue-generation-button')).toBeNull();
  });
});

describe('HoverButtons feedback affordance', () => {
  const assistantMessage = {
    ...userMessage,
    messageId: 'assistant-1',
    isCreatedByUser: false,
    text: 'Here is the answer',
  } as TMessage;

  const renderSettledResponse = (handleFeedback?: () => void) =>
    renderHoverButtons({
      isSubmitting: false,
      message: assistantMessage,
      isLast: true,
      latestMessageId: 'assistant-2',
      handleFeedback,
    });

  it('offers feedback on a settled response when a handler is supplied', () => {
    renderSettledResponse(jest.fn());

    expect(screen.getByTitle('Love this')).toBeInTheDocument();
    expect(screen.getByTitle('Needs improvement')).toBeInTheDocument();
  });

  /** `useMessageActions` withholds the handler when `interface.feedback` is false, so
   *  this is how a deployment that disabled feedback reaches the action row. */
  it('hides feedback when no handler is supplied', () => {
    renderSettledResponse();

    expect(screen.queryByTitle('Love this')).toBeNull();
    expect(screen.queryByTitle('Needs improvement')).toBeNull();
    expect(screen.getByTestId('copy-response-button')).toBeInTheDocument();
  });
});

/**
 * The three switches this deployment turns off. Each is absent by default, so an
 * unconfigured install keeps every button — the assertions below pin both halves.
 */
describe('HoverButtons interface switches', () => {
  const assistantMessage = {
    ...userMessage,
    messageId: 'assistant-1',
    isCreatedByUser: false,
    text: 'Готовый ответ',
  } as TMessage;

  const settled = {
    isSubmitting: false,
    message: assistantMessage,
    latestMessageId: 'assistant-1',
    isLast: true,
  };

  it('drops the read-aloud button when the admin switched it off', () => {
    renderHoverButtons({ ...settled, readAloudOn: true, interfaceConfig: { textToSpeech: false } });
    expect(screen.queryByTestId('read-aloud-stub')).not.toBeInTheDocument();
  });

  it('keeps the read-aloud button when the admin said nothing', () => {
    renderHoverButtons({ ...settled, readAloudOn: true, interfaceConfig: {} });
    expect(screen.getByTestId('read-aloud-stub')).toBeInTheDocument();
  });

  it('still respects the employee own speech preference when the admin said nothing', () => {
    renderHoverButtons({ ...settled, readAloudOn: false, interfaceConfig: {} });
    expect(screen.queryByTestId('read-aloud-stub')).not.toBeInTheDocument();
  });

  it('drops the edit button when the admin switched it off', () => {
    const container = renderHoverButtons({
      isSubmitting: false,
      interfaceConfig: { messageEdit: false },
    });
    expect(container.querySelector(`#edit-${userMessage.messageId}`)).toBeNull();
  });

  it('keeps the edit button when the admin said nothing', () => {
    const container = renderHoverButtons({ isSubmitting: false, interfaceConfig: {} });
    expect(container.querySelector(`#edit-${userMessage.messageId}`)).not.toBeNull();
  });

  it('drops the branch button when the admin switched it off', () => {
    renderHoverButtons({ ...settled, interfaceConfig: { fork: false } });
    expect(screen.queryByRole('button', { name: /fork|ветвлен/i })).not.toBeInTheDocument();
  });

  it('keeps the branch button when the admin said nothing', () => {
    renderHoverButtons({ ...settled, interfaceConfig: {} });
    expect(screen.getByRole('button', { name: /fork|ветвлен/i })).toBeInTheDocument();
  });

  it('leaves copy alone — it is not one of the switches', () => {
    renderHoverButtons({
      ...settled,
      interfaceConfig: { textToSpeech: false, messageEdit: false, fork: false },
    });
    expect(screen.getByTestId('copy-response-button')).toBeInTheDocument();
  });
});
