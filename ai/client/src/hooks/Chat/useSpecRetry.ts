import { useEffect } from 'react';
import { Constants } from 'librechat-data-provider';
import { useRecoilState } from 'recoil';
import useChatHelpers from './useChatHelpers';
import { pendingSpecRetry } from '~/store/emptyResponse';

type SpecRetryChatHelpers = Pick<
  ReturnType<typeof useChatHelpers>,
  'conversation' | 'getMessages' | 'regenerate' | 'isSubmitting'
>;

const PENDING_SPEC_RETRY_TTL_MS = 60 * 1000;

export default function useSpecRetry(
  conversationId: string | undefined,
  chatHelpers: SpecRetryChatHelpers,
): void {
  const { conversation, getMessages, regenerate, isSubmitting } = chatHelpers;
  const [pending, setPending] = useRecoilState(
    pendingSpecRetry(conversationId ?? Constants.NEW_CONVO),
  );

  useEffect(() => {
    if (pending == null || isSubmitting) {
      return;
    }
    if (Date.now() - pending.requestedAt > PENDING_SPEC_RETRY_TTL_MS) {
      setPending(null);
      return;
    }
    if (conversation?.spec !== pending.spec) {
      return;
    }
    const parentMessage = getMessages()?.find(
      (message) => message.messageId === pending.parentMessageId,
    );
    if (parentMessage == null || parentMessage.isCreatedByUser !== true) {
      setPending(null);
      return;
    }

    setPending(null);
    regenerate({
      messageId: pending.messageId,
      parentMessageId: pending.parentMessageId,
      isCreatedByUser: false,
    });
  }, [pending, isSubmitting, conversation?.spec, getMessages, regenerate, setPending]);
}
