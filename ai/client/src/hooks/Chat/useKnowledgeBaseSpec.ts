import { useMemo } from 'react';
import { useChatContext } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import { getModelSpec } from '~/utils';

/**
 * Whether the conversation's active model spec has `knowledgeBase: true`.
 * Only specs opted into a knowledge base expose the mandatory document-search
 * toggle — surfacing it for other specs would let a user believe a search
 * happened when the model has no knowledge base tool available.
 */
export default function useKnowledgeBaseSpec(): boolean {
  const { conversation } = useChatContext();
  const { data: startupConfig } = useGetStartupConfig();

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  return modelSpec?.knowledgeBase === true;
}
