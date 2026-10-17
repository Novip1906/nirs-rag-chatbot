import { useCallback, useMemo } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage, TModelSpec, TEndpointsConfig } from 'librechat-data-provider';
import { pendingSpecRetry } from '~/store/emptyResponse';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useGetConversation, useNewConvo } from '~/hooks';
import { useAssistantsMapContext } from '~/Providers';
import useSelectMention from '~/hooks/Input/useSelectMention';
import store from '~/store';

interface EmptyResponseModelPickerProps {
  index: number;
  conversationId?: string | null;
  message: TMessage;
}

export default function EmptyResponseModelPicker({
  index,
  conversationId,
  message,
}: EmptyResponseModelPickerProps): JSX.Element | null {
  const setPendingSpecRetry = useSetRecoilState(pendingSpecRetry(conversationId ?? ''));

  const getConversation = useGetConversation(index);
  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const currentSpec = useRecoilValue(store.conversationSpecByIndex(index));

  const modelSpecs = useMemo(
    () => startupConfig?.modelSpecs?.list ?? [],
    [startupConfig?.modelSpecs?.list],
  );
  const alternativeSpecs = useMemo(
    () => modelSpecs.filter((spec) => spec.name !== currentSpec),
    [modelSpecs, currentSpec],
  );

  const { onSelectSpec } = useSelectMention({
    modelSpecs,
    assistantsMap,
    endpointsConfig,
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const handleSelectSpec = useCallback(
    (spec: TModelSpec) => {
      if (message.parentMessageId == null) {
        return;
      }
      setPendingSpecRetry({
        spec: spec.name,
        messageId: message.messageId,
        parentMessageId: message.parentMessageId,
        requestedAt: Date.now(),
      });
      onSelectSpec?.(spec);
    },
    [message.messageId, message.parentMessageId, onSelectSpec, setPendingSpecRetry],
  );

  if (conversationId == null || conversationId === '') {
    return null;
  }
  if (alternativeSpecs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {alternativeSpecs.map((spec) => (
        <button
          key={spec.name}
          type="button"
          onClick={() => handleSelectSpec(spec)}
          className="rounded-md px-2 py-1 text-text-primary hover:bg-surface-hover"
        >
          {spec.label ?? spec.name}
        </button>
      ))}
    </div>
  );
}
