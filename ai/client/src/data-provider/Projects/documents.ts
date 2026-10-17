import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type {
  QueryObserverResult,
  UseMutationResult,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  TDeleteProjectDocumentResponse,
  TProjectDocumentResponse,
  TProjectDocumentsListResponse,
} from 'librechat-data-provider';

export const useProjectDocumentsQuery = (
  projectId: string,
  config?: UseQueryOptions<TProjectDocumentsListResponse>,
): QueryObserverResult<TProjectDocumentsListResponse> =>
  useQuery<TProjectDocumentsListResponse>(
    [QueryKeys.projectDocuments, projectId],
    () => dataService.listProjectDocuments(projectId),
    {
      enabled: Boolean(projectId),
      refetchOnWindowFocus: false,
      ...config,
    },
  );

export const useUploadProjectDocumentMutation = (): UseMutationResult<
  TProjectDocumentResponse,
  unknown,
  { projectId: string; formData: FormData },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ projectId, formData }) => dataService.uploadProjectDocument(projectId, formData),
    {
      onSuccess: (_data, { projectId }) => {
        queryClient.invalidateQueries([QueryKeys.projectDocuments, projectId]);
      },
    },
  );
};

export const useReindexProjectDocumentMutation = (): UseMutationResult<
  TProjectDocumentResponse,
  unknown,
  { projectId: string; fileId: string },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(({ fileId }) => dataService.reindexProjectDocument(fileId), {
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries([QueryKeys.projectDocuments, projectId]);
    },
  });
};

export const useDeleteProjectDocumentMutation = (): UseMutationResult<
  TDeleteProjectDocumentResponse,
  unknown,
  { projectId: string; fileId: string },
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(({ fileId }) => dataService.deleteProjectDocument(fileId), {
    onSuccess: (_data, { projectId }) => {
      queryClient.invalidateQueries([QueryKeys.projectDocuments, projectId]);
    },
  });
};
