import { useEffect, useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import { useToastContext } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { autoRetriedEmptyResponse, dismissedEmptyResponse } from '~/store/emptyResponse';
import EmptyResponseModelPicker from './EmptyResponseModelPicker';
import { useGetStartupConfig } from '~/data-provider';
import { isEmptyAssistantResponse, markAutoRetried, wasAutoRetried } from '~/utils';
import { useLocalize } from '~/hooks';

const RETRY_IN_FLIGHT_TIMEOUT_MS = 15 * 1000;

interface EmptyResponseRecoveryProps {
  message: TMessage;
  isLast: boolean;
  isSubmitting: boolean;
  conversationId?: string | null;
  regenerate: () => void;
  index: number;
}

export default function EmptyResponseRecovery({
  message,
  isLast,
  isSubmitting,
  conversationId,
  regenerate,
  index,
}: EmptyResponseRecoveryProps): JSX.Element | null {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEmpty = isEmptyAssistantResponse(message);
  const retryKey = `${conversationId ?? ''}|${message.parentMessageId ?? ''}`;
  const [autoRetried, setAutoRetried] = useRecoilState(autoRetriedEmptyResponse(retryKey));
  const [dismissed, setDismissed] = useRecoilState(dismissedEmptyResponse(message.messageId));
  const wasSubmittingRef = useRef(isSubmitting);
  const justFinishedRef = useRef(false);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const { data: startupConfig } = useGetStartupConfig();
  const hasAlternativeSpecs = (startupConfig?.modelSpecs?.list?.length ?? 0) > 1;

  useEffect(() => {
    const wasSubmitting = wasSubmittingRef.current;
    wasSubmittingRef.current = isSubmitting;

    if (isSubmitting) {
      if (!wasSubmitting) {
        setRetryInFlight(false);
      }
      justFinishedRef.current = false;
      return;
    }
    if (wasSubmitting) {
      justFinishedRef.current = true;
    }
    if (!justFinishedRef.current) {
      return;
    }
    if (!isEmpty || !isLast || autoRetried || wasAutoRetried(retryKey)) {
      return;
    }

    justFinishedRef.current = false;
    setAutoRetried(true);
    markAutoRetried(retryKey);
    setRetryInFlight(true);
    showToast({ message: localize('com_ui_empty_response_retrying'), status: 'info' });
    regenerate();
  }, [
    isSubmitting,
    isEmpty,
    isLast,
    autoRetried,
    retryKey,
    setAutoRetried,
    showToast,
    localize,
    regenerate,
  ]);

  useEffect(() => {
    if (!retryInFlight) {
      return;
    }
    const timeoutId = setTimeout(() => setRetryInFlight(false), RETRY_IN_FLIGHT_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [retryInFlight]);

  if (!isEmpty || !isLast || isSubmitting || dismissed || retryInFlight) {
    return null;
  }

  const canSwitchModel = message.parentMessageId != null && hasAlternativeSpecs;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary">
      <div className="flex items-start gap-2">
        <span role="status" className="flex-1">
          {localize('com_ui_empty_response_title')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={regenerate}
            className="rounded-md px-2 py-1 text-text-primary hover:bg-surface-hover"
          >
            {localize('com_ui_empty_response_retry')}
          </button>
          {canSwitchModel && (
            <button
              type="button"
              onClick={() => setShowModelPicker((prev) => !prev)}
              className="rounded-md px-2 py-1 text-text-primary hover:bg-surface-hover"
            >
              {localize('com_ui_empty_response_other_model')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md px-2 py-1 hover:bg-surface-hover"
          >
            {localize('com_ui_empty_response_dismiss')}
          </button>
        </div>
      </div>
      {showModelPicker && canSwitchModel && (
        <EmptyResponseModelPicker index={index} conversationId={conversationId} message={message} />
      )}
    </div>
  );
}
