import { useCallback, useMemo } from 'react';
import { Button } from '@librechat/client';
import { ContentTypes, ErrorTypes } from 'librechat-data-provider';
import type { TMessage, TEndpointsConfig, AttachmentErrorParams } from 'librechat-data-provider';
import { useGetConversation, useNewConvo, useLocalize, useModelSuggestion } from '~/hooks';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { useAssistantsMapContext } from '~/Providers';
import { extractJson, isJson } from '~/utils/json';

interface ParsedContextOverflowError {
  type?: string;
  params?: AttachmentErrorParams;
}

function getRequiredContextTokens(message: TMessage): number | null {
  const parts = message.content;
  if (!Array.isArray(parts)) {
    return null;
  }
  for (const part of parts) {
    if (part?.type !== ContentTypes.ERROR) {
      continue;
    }
    const text = part.error ?? (typeof part.text === 'string' ? part.text : part.text?.value);
    if (!text) {
      continue;
    }
    const jsonString = extractJson(text);
    if (!isJson(jsonString)) {
      continue;
    }
    const parsed = JSON.parse(jsonString) as ParsedContextOverflowError;
    if (parsed.type !== ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW) {
      continue;
    }
    const requiredContextTokens = parsed.params?.requiredContextTokens;
    return typeof requiredContextTokens === 'number' ? requiredContextTokens : null;
  }
  return null;
}

interface ContextOverflowModelSwitchProps {
  index: number;
  message: TMessage;
}

export default function ContextOverflowModelSwitch({
  index,
  message,
}: ContextOverflowModelSwitchProps): JSX.Element | null {
  const localize = useLocalize();
  const requiredContextTokens = useMemo(() => getRequiredContextTokens(message), [message]);
  const suggestion = useModelSuggestion(requiredContextTokens ?? 0);

  const getConversation = useGetConversation(index);
  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const modelSpecs = useMemo(
    () => startupConfig?.modelSpecs?.list ?? [],
    [startupConfig?.modelSpecs?.list],
  );

  const { onSelectSpec } = useSelectMention({
    modelSpecs,
    assistantsMap,
    endpointsConfig,
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const handleClick = useCallback(() => {
    if (suggestion) {
      onSelectSpec?.(suggestion);
    }
  }, [suggestion, onSelectSpec]);

  if (requiredContextTokens == null || suggestion == null) {
    return null;
  }

  return (
    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={handleClick}>
      {localize('com_ui_switch_to_model', { 0: suggestion.label ?? suggestion.name })}
    </Button>
  );
}
