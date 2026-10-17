import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { TMessage, TModelSpec, TConversation } from 'librechat-data-provider';
import type { PendingSpecRetry } from '~/store/emptyResponse';
import type { MutableSnapshot } from 'recoil';
import { autoRetriedEmptyResponse, pendingSpecRetry } from '~/store/emptyResponse';
import EmptyResponseRecovery from '../EmptyResponseRecovery';
import { markAutoRetried } from '~/utils';
import store from '~/store';

const mockShowToast = jest.fn();
const mockOnSelectSpec = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => {
    const labels: Record<string, string> = {
      com_ui_empty_response_retrying: 'The model returned nothing — sending the request again.',
      com_ui_empty_response_title: 'The model failed to produce an answer.',
      com_ui_empty_response_retry: 'Send again',
      com_ui_empty_response_other_model: 'Another model',
      com_ui_empty_response_dismiss: 'Never mind',
    };
    return labels[key] ?? key;
  },
  useGetConversation: () => () => null,
  useNewConvo: () => ({ newConversation: jest.fn() }),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/Providers', () => ({
  useAssistantsMapContext: () => ({}),
}));

jest.mock('~/hooks/Input/useSelectMention', () => () => ({
  onSelectEndpoint: jest.fn(),
  onSelectSpec: mockOnSelectSpec,
}));

const mockUseGetStartupConfig = jest.fn((): { data?: { modelSpecs: { list: TModelSpec[] } } } => ({
  data: { modelSpecs: { list: [] } },
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

const makeSpec = (name: string): TModelSpec => ({ name, label: `${name} label` }) as TModelSpec;

const baseMessage = (overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: 'response-1',
    conversationId: 'convo-1',
    parentMessageId: 'user-1',
    isCreatedByUser: false,
    text: '',
    ...overrides,
  }) as TMessage;

const setCurrentSpec = (snapshot: MutableSnapshot, spec: string) =>
  snapshot.set(store.conversationByIndex(0), { spec } as TConversation);

const renderRecovery = (
  props: {
    message: TMessage;
    isLast: boolean;
    isSubmitting: boolean;
    conversationId?: string | null;
    regenerate: () => void;
    index?: number;
  },
  initializeState?: (snapshot: MutableSnapshot) => void,
) =>
  render(
    <RecoilRoot initializeState={initializeState}>
      <EmptyResponseRecovery index={0} {...props} />
    </RecoilRoot>,
  );

describe('EmptyResponseRecovery', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    mockOnSelectSpec.mockClear();
    mockUseGetStartupConfig.mockReturnValue({ data: { modelSpecs: { list: [] } } });
    localStorage.clear();
  });

  it('auto-retries exactly once on the submitting-to-idle transition and does not show the card', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ text: '', content: [] });
    const { rerender } = renderRecovery({
      message,
      isLast: true,
      isSubmitting: true,
      conversationId: 'convo-1',
      regenerate,
    });

    rerender(
      <RecoilRoot>
        <EmptyResponseRecovery
          message={message}
          isLast={true}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
      </RecoilRoot>,
    );

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'The model returned nothing — sending the request again.',
      status: 'info',
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not auto-retry after a page reload when the localStorage registry already recorded this question', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-1b', text: '', content: [] });
    markAutoRetried('convo-1|user-1');

    const { rerender } = renderRecovery({
      message,
      isLast: true,
      isSubmitting: true,
      conversationId: 'convo-1',
      regenerate,
    });

    rerender(
      <RecoilRoot>
        <EmptyResponseRecovery
          message={message}
          isLast={true}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
      </RecoilRoot>,
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('still auto-retries on a later render when isEmpty/isLast lag one commit behind the isSubmitting transition', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-1c', text: '', content: [] });

    const { rerender } = renderRecovery({
      message,
      isLast: false,
      isSubmitting: true,
      conversationId: 'convo-1',
      regenerate,
    });

    rerender(
      <RecoilRoot>
        <EmptyResponseRecovery
          message={message}
          isLast={false}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
      </RecoilRoot>,
    );
    expect(regenerate).not.toHaveBeenCalled();

    rerender(
      <RecoilRoot>
        <EmptyResponseRecovery
          message={message}
          isLast={true}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
      </RecoilRoot>,
    );

    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('clears the stuck "retry in flight" state after 15 seconds when regenerate never starts a new submission', () => {
    jest.useFakeTimers();
    try {
      const regenerate = jest.fn();
      const message = baseMessage({ messageId: 'response-1d', text: '', content: [] });

      const { rerender } = renderRecovery({
        message,
        isLast: true,
        isSubmitting: true,
        conversationId: 'convo-1',
        regenerate,
      });

      rerender(
        <RecoilRoot>
          <EmptyResponseRecovery
            message={message}
            isLast={true}
            isSubmitting={false}
            conversationId="convo-1"
            regenerate={regenerate}
            index={0}
          />
        </RecoilRoot>,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(15000);
      });

      expect(screen.getByRole('status')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the recovery card without retrying again for a second empty response on the same parent message', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-2', text: '', content: [] });
    const retryKey = 'convo-1|user-1';

    renderRecovery(
      {
        message,
        isLast: true,
        isSubmitting: false,
        conversationId: 'convo-1',
        regenerate,
      },
      (snapshot) => snapshot.set(autoRetriedEmptyResponse(retryKey), true),
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('The model failed to produce an answer.')).toBeInTheDocument();
  });

  it('calls regenerate when the retry button is clicked', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-3', text: '', content: [] });

    renderRecovery(
      {
        message,
        isLast: true,
        isSubmitting: false,
        conversationId: 'convo-1',
        regenerate,
      },
      (snapshot) => snapshot.set(autoRetriedEmptyResponse('convo-1|user-1'), true),
    );

    fireEvent.click(screen.getByText('Send again'));
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('removes the card when the dismiss button is clicked', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-4', text: '', content: [] });

    renderRecovery(
      {
        message,
        isLast: true,
        isSubmitting: false,
        conversationId: 'convo-1',
        regenerate,
      },
      (snapshot) => snapshot.set(autoRetriedEmptyResponse('convo-1|user-1'), true),
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Never mind'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing and never retries for a non-empty response', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ text: 'All good here.' });
    const { rerender } = renderRecovery({
      message,
      isLast: true,
      isSubmitting: true,
      conversationId: 'convo-1',
      regenerate,
    });

    rerender(
      <RecoilRoot>
        <EmptyResponseRecovery
          message={message}
          isLast={true}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
      </RecoilRoot>,
    );

    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows alternative models and hides the current one after clicking "Another model"', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-5' });
    const specGpt = makeSpec('gpt-4');
    const specClaude = makeSpec('claude');
    const specGemini = makeSpec('gemini');
    mockUseGetStartupConfig.mockReturnValue({
      data: { modelSpecs: { list: [specGpt, specClaude, specGemini] } },
    });

    renderRecovery(
      {
        message,
        isLast: true,
        isSubmitting: false,
        conversationId: 'convo-1',
        regenerate,
      },
      (snapshot) => {
        snapshot.set(autoRetriedEmptyResponse('convo-1|user-1'), true);
        setCurrentSpec(snapshot, 'gpt-4');
      },
    );

    fireEvent.click(screen.getByText('Another model'));

    expect(screen.getByText('claude label')).toBeInTheDocument();
    expect(screen.getByText('gemini label')).toBeInTheDocument();
    expect(screen.queryByText('gpt-4 label')).not.toBeInTheDocument();
  });

  it('selecting an alternative model calls onSelectSpec and records pendingSpecRetry', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-6', parentMessageId: 'user-6' });
    const specGpt = makeSpec('gpt-4');
    const specClaude = makeSpec('claude');
    mockUseGetStartupConfig.mockReturnValue({
      data: { modelSpecs: { list: [specGpt, specClaude] } },
    });

    const captured: { pending: PendingSpecRetry | null } = { pending: null };
    function PendingRetryProbe() {
      captured.pending = useRecoilValue(pendingSpecRetry('convo-1'));
      return <div data-testid="pending-retry">{captured.pending ? 'set' : 'none'}</div>;
    }

    const beforeClick = Date.now();
    render(
      <RecoilRoot
        initializeState={(snapshot) => {
          snapshot.set(autoRetriedEmptyResponse('convo-1|user-6'), true);
          setCurrentSpec(snapshot, 'gpt-4');
        }}
      >
        <EmptyResponseRecovery
          message={message}
          isLast={true}
          isSubmitting={false}
          conversationId="convo-1"
          regenerate={regenerate}
          index={0}
        />
        <PendingRetryProbe />
      </RecoilRoot>,
    );

    fireEvent.click(screen.getByText('Another model'));
    fireEvent.click(screen.getByText('claude label'));

    expect(mockOnSelectSpec).toHaveBeenCalledWith(specClaude);
    expect(captured.pending).toMatchObject({
      spec: 'claude',
      messageId: 'response-6',
      parentMessageId: 'user-6',
    });
    expect(captured.pending?.requestedAt).toBeGreaterThanOrEqual(beforeClick);
  });

  it('does not render "Another model" when there is only one model spec', () => {
    const regenerate = jest.fn();
    const message = baseMessage({ messageId: 'response-7' });
    const specGpt = makeSpec('gpt-4');
    mockUseGetStartupConfig.mockReturnValue({
      data: { modelSpecs: { list: [specGpt] } },
    });

    renderRecovery(
      {
        message,
        isLast: true,
        isSubmitting: false,
        conversationId: 'convo-1',
        regenerate,
      },
      (snapshot) => {
        snapshot.set(autoRetriedEmptyResponse('convo-1|user-1'), true);
        setCurrentSpec(snapshot, 'gpt-4');
      },
    );

    expect(screen.queryByText('Another model')).not.toBeInTheDocument();
  });
});
