import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type { KnowledgeDocumentItem, KnowledgeSpaceItem } from '~/api';
import type { KnowledgeDocumentPreview } from './request';
import { getKnowledgeDocumentPreview, getKnowledgeDocuments, getKnowledgeSpaces } from './request';
import { knowledgeKeys } from './keys';

export const useKnowledgeSpacesQuery = (
  config?: UseQueryOptions<KnowledgeSpaceItem[]>,
): QueryObserverResult<KnowledgeSpaceItem[]> =>
  useQuery<KnowledgeSpaceItem[]>(knowledgeKeys.spaces, getKnowledgeSpaces, {
    refetchOnWindowFocus: false,
    ...config,
  });

export const useKnowledgeDocumentsQuery = (
  spaceId: string | null | undefined,
  config?: UseQueryOptions<KnowledgeDocumentItem[]>,
): QueryObserverResult<KnowledgeDocumentItem[]> =>
  useQuery<KnowledgeDocumentItem[]>(
    knowledgeKeys.documents(spaceId ?? ''),
    () => getKnowledgeDocuments(spaceId ?? ''),
    { refetchOnWindowFocus: false, enabled: spaceId != null && spaceId !== '', ...config },
  );

/**
 * Fetches the preview payload for a single document. `enabled` should track
 * the preview dialog's own open state — the dialog is the only caller, and
 * there is no reason to hit the endpoint before it is actually shown.
 */
export const useKnowledgeDocumentPreview = (
  fileId: string | null | undefined,
  enabled: boolean,
): QueryObserverResult<KnowledgeDocumentPreview> =>
  useQuery<KnowledgeDocumentPreview>(
    knowledgeKeys.documentPreview(fileId ?? ''),
    () => getKnowledgeDocumentPreview(fileId ?? ''),
    {
      refetchOnWindowFocus: false,
      retry: false,
      enabled: enabled && fileId != null && fileId !== '',
    },
  );
