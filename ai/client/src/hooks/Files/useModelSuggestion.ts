import { useMemo } from 'react';
import type { TModelSpec } from 'librechat-data-provider';
import { pickModelSuggestion, resolveSpecContext } from '~/utils/attachments';
import { useGetStartupConfig, useTokenConfigQuery } from '~/data-provider';
import { useChatContext } from '~/Providers/ChatContext';

export default function useModelSuggestion(requiredContextTokens: number): TModelSpec | null {
  const { data: startupConfig } = useGetStartupConfig();
  const { data: tokenConfig } = useTokenConfigQuery();
  const { conversation } = useChatContext();

  const specsList = startupConfig?.modelSpecs?.list;
  const currentSpecName = conversation?.spec ?? undefined;

  return useMemo(
    () =>
      pickModelSuggestion(specsList ?? [], currentSpecName, requiredContextTokens, (spec) =>
        resolveSpecContext(spec, tokenConfig),
      ),
    [specsList, currentSpecName, requiredContextTokens, tokenConfig],
  );
}
