import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { TLangfuseSessionLinkResponse } from 'librechat-data-provider';
import type { UseQueryResult } from '@tanstack/react-query';

export const useGetLangfuseSessionLinkQuery = (
  conversationId: string,
  enabled = true,
): UseQueryResult<TLangfuseSessionLinkResponse> =>
  useQuery<TLangfuseSessionLinkResponse>(
    [QueryKeys.langfuseSessionLink, conversationId],
    () => dataService.getLangfuseSessionLink(conversationId),
    { enabled, refetchOnWindowFocus: false },
  );
