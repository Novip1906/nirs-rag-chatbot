import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TMessage, TConversation } from 'librechat-data-provider';
import { pendingSpecRetry, type PendingSpecRetry } from '~/store/emptyResponse';
import useSpecRetry from '../useSpecRetry';

const makeMessage = (overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: 'user-1',
    parentMessageId: null,
    isCreatedByUser: true,
    text: 'hi',
    ...overrides,
  }) as TMessage;

function PendingProbe({ conversationId }: { conversationId: string }) {
  const pending = useRecoilValue(pendingSpecRetry(conversationId));
  return <div data-testid="pending">{pending ? JSON.stringify(pending) : 'none'}</div>;
}

function Harness({
  conversationId,
  spec,
  isSubmitting,
  messages,
  regenerate,
}: {
  conversationId: string;
  spec: string | undefined;
  isSubmitting: boolean;
  messages: TMessage[];
  regenerate: jest.Mock;
}) {
  useSpecRetry(conversationId, {
    conversation: { conversationId, spec } as TConversation,
    getMessages: () => messages,
    regenerate,
    isSubmitting,
  });
  return <PendingProbe conversationId={conversationId} />;
}

const renderHarness = (
  props: {
    conversationId: string;
    spec: string | undefined;
    isSubmitting: boolean;
    messages: TMessage[];
    regenerate: jest.Mock;
  },
  pending: PendingSpecRetry,
) =>
  render(
    <RecoilRoot
      initializeState={(snapshot) => snapshot.set(pendingSpecRetry(props.conversationId), pending)}
    >
      <Harness {...props} />
    </RecoilRoot>,
  );

describe('useSpecRetry', () => {
  it('regenerates once the conversation switched to the pending spec and clears the atom', () => {
    const regenerate = jest.fn();
    const parentMessage = makeMessage({ messageId: 'user-1', isCreatedByUser: true });

    renderHarness(
      {
        conversationId: 'convo-1',
        spec: 'claude',
        isSubmitting: false,
        messages: [parentMessage],
        regenerate,
      },
      {
        spec: 'claude',
        messageId: 'response-1',
        parentMessageId: 'user-1',
        requestedAt: Date.now(),
      },
    );

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith({
      messageId: 'response-1',
      parentMessageId: 'user-1',
      isCreatedByUser: false,
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('does not regenerate while the conversation still carries the old spec', () => {
    const regenerate = jest.fn();
    const parentMessage = makeMessage({ messageId: 'user-1', isCreatedByUser: true });
    const requestedAt = Date.now();

    renderHarness(
      {
        conversationId: 'convo-1',
        spec: 'gpt-4',
        isSubmitting: false,
        messages: [parentMessage],
        regenerate,
      },
      { spec: 'claude', messageId: 'response-1', parentMessageId: 'user-1', requestedAt },
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent(
      JSON.stringify({
        spec: 'claude',
        messageId: 'response-1',
        parentMessageId: 'user-1',
        requestedAt,
      }),
    );
  });

  it('clears the atom without regenerating when the parent message is missing', () => {
    const regenerate = jest.fn();

    renderHarness(
      {
        conversationId: 'convo-1',
        spec: 'claude',
        isSubmitting: false,
        messages: [],
        regenerate,
      },
      {
        spec: 'claude',
        messageId: 'response-1',
        parentMessageId: 'user-1',
        requestedAt: Date.now(),
      },
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('clears the atom without regenerating when the pending retry is older than 60 seconds', () => {
    const regenerate = jest.fn();
    const parentMessage = makeMessage({ messageId: 'user-1', isCreatedByUser: true });

    renderHarness(
      {
        conversationId: 'convo-1',
        spec: 'claude',
        isSubmitting: false,
        messages: [parentMessage],
        regenerate,
      },
      {
        spec: 'claude',
        messageId: 'response-1',
        parentMessageId: 'user-1',
        requestedAt: Date.now() - 61 * 1000,
      },
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });
});
