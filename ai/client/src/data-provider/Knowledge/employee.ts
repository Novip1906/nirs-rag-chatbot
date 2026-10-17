import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type {
  QueryObserverResult,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  KnowledgeDocumentItem,
  KnowledgeDocumentResponse,
  KnowledgeDocumentsListResponse,
  KnowledgeSpaceSummariesResponse,
  KnowledgeSpaceSummary,
  KnowledgeSpaceSummaryInput,
  KnowledgeSpaceSummaryResponse,
} from 'librechat-data-provider';
import type { AxiosProgressEvent } from 'axios';
import { knowledgeKeys } from './keys';

const employeeKnowledgeBase = (): string => `${apiBaseUrl()}/api/office/knowledge`;

export const getEmployeeKnowledgeSpaces = async (): Promise<KnowledgeSpaceSummary[]> => {
  const response: KnowledgeSpaceSummariesResponse = await request.get(
    `${employeeKnowledgeBase()}/spaces`,
  );
  return response.spaces;
};

export const createEmployeeKnowledgeSpace = async (
  payload: KnowledgeSpaceSummaryInput,
): Promise<KnowledgeSpaceSummary> => {
  const response: KnowledgeSpaceSummaryResponse = await request.post(
    `${employeeKnowledgeBase()}/spaces`,
    payload,
  );
  return response.space;
};

export const updateEmployeeKnowledgeSpace = async (
  id: string,
  payload: Partial<KnowledgeSpaceSummaryInput>,
): Promise<KnowledgeSpaceSummary> => {
  const response: KnowledgeSpaceSummaryResponse = await request.patch(
    `${employeeKnowledgeBase()}/spaces/${encodeURIComponent(id)}`,
    payload,
  );
  return response.space;
};

export const deleteEmployeeKnowledgeSpace = async (id: string): Promise<void> => {
  await request.delete(`${employeeKnowledgeBase()}/spaces/${encodeURIComponent(id)}`);
};

/**
 * `includeArchived` — только запрос: сервер честно возвращает архивные лишь тому,
 * кто распоряжается пространством (`space.canManage`), рядового сотрудника флаг
 * не расширяет — см. `employee.ts` (`listDocumentsHandler`) на бэкенде.
 */
export const getEmployeeKnowledgeDocuments = async (
  spaceId: string,
  includeArchived = false,
): Promise<KnowledgeDocumentItem[]> => {
  const query = includeArchived ? '?includeArchived=true' : '';
  const response: KnowledgeDocumentsListResponse = await request.get(
    `${employeeKnowledgeBase()}/spaces/${encodeURIComponent(spaceId)}/documents${query}`,
  );
  return response.documents;
};

export interface EmployeeDocumentUpdateInput {
  title?: string;
  description?: string;
  effectiveDate?: string | null;
}

export interface EmployeeDocumentUploadInput {
  file: File;
  title: string;
  description?: string;
  effectiveDate?: string | null;
  supersedesId?: string | null;
}

export const updateEmployeeKnowledgeDocument = async (
  id: string,
  payload: EmployeeDocumentUpdateInput,
): Promise<KnowledgeDocumentItem> => {
  const response: KnowledgeDocumentResponse = await request.patch(
    `${employeeKnowledgeBase()}/documents/${encodeURIComponent(id)}`,
    payload,
  );
  return response.document;
};

export const archiveEmployeeKnowledgeDocument = async (
  id: string,
): Promise<KnowledgeDocumentItem> => {
  const response: KnowledgeDocumentResponse = await request.post(
    `${employeeKnowledgeBase()}/documents/${encodeURIComponent(id)}/archive`,
  );
  return response.document;
};

/** Безвозвратно, в отличие от архивации — снимает и проиндексированное содержимое. */
export const deleteEmployeeKnowledgeDocument = async (id: string): Promise<void> => {
  await request.delete(`${employeeKnowledgeBase()}/documents/${encodeURIComponent(id)}`);
};

export const uploadEmployeeKnowledgeDocument = async (
  spaceId: string,
  input: EmployeeDocumentUploadInput,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void,
): Promise<KnowledgeDocumentItem> => {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('title', input.title);
  if (input.description != null) {
    formData.append('description', input.description);
  }
  if (input.effectiveDate != null) {
    formData.append('effectiveDate', input.effectiveDate);
  }
  if (input.supersedesId != null) {
    formData.append('supersedesId', input.supersedesId);
  }
  const response: KnowledgeDocumentResponse = await request.postMultiPart(
    `${employeeKnowledgeBase()}/spaces/${encodeURIComponent(spaceId)}/documents`,
    formData,
    onUploadProgress != null ? { onUploadProgress } : undefined,
  );
  return response.document;
};

export const useEmployeeSpacesQuery = (
  config?: UseQueryOptions<KnowledgeSpaceSummary[]>,
): QueryObserverResult<KnowledgeSpaceSummary[]> =>
  useQuery<KnowledgeSpaceSummary[]>(knowledgeKeys.employeeSpaces, getEmployeeKnowledgeSpaces, {
    refetchOnWindowFocus: false,
    ...config,
  });

export const useCreateEmployeeSpaceMutation = (
  options?: UseMutationOptions<KnowledgeSpaceSummary, unknown, KnowledgeSpaceSummaryInput>,
): UseMutationResult<KnowledgeSpaceSummary, unknown, KnowledgeSpaceSummaryInput> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: KnowledgeSpaceSummaryInput) => createEmployeeKnowledgeSpace(payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries(knowledgeKeys.employeeSpaces);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

interface UpdateEmployeeSpaceVariables {
  id: string;
  payload: Partial<KnowledgeSpaceSummaryInput>;
}

export const useUpdateEmployeeSpaceMutation = (
  options?: UseMutationOptions<KnowledgeSpaceSummary, unknown, UpdateEmployeeSpaceVariables>,
): UseMutationResult<KnowledgeSpaceSummary, unknown, UpdateEmployeeSpaceVariables> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, payload }: UpdateEmployeeSpaceVariables) => updateEmployeeKnowledgeSpace(id, payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries(knowledgeKeys.employeeSpaces);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useDeleteEmployeeSpaceMutation = (
  options?: UseMutationOptions<void, unknown, string>,
): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => deleteEmployeeKnowledgeSpace(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(knowledgeKeys.employeeSpaces);
      options?.onSuccess?.(data, variables, context);
    },
  });
};

/**
 * `includeArchived` is part of the query key (appended after the shared prefix,
 * not baked into `knowledgeKeys.employeeDocuments` itself) so an archive/delete
 * mutation's `invalidateQueries(knowledgeKeys.employeeDocuments(spaceId))` still
 * matches both the active-only and the include-archived cache entry — React
 * Query's default partial key matching does that as long as the shared prefix
 * stays a plain array.
 */
export const useEmployeeDocumentsQuery = (
  spaceId: string | null | undefined,
  includeArchived = false,
  config?: UseQueryOptions<KnowledgeDocumentItem[]>,
): QueryObserverResult<KnowledgeDocumentItem[]> =>
  useQuery<KnowledgeDocumentItem[]>(
    [...knowledgeKeys.employeeDocuments(spaceId ?? ''), includeArchived],
    () => getEmployeeKnowledgeDocuments(spaceId ?? '', includeArchived),
    { refetchOnWindowFocus: false, enabled: spaceId != null && spaceId !== '', ...config },
  );

interface UpdateEmployeeDocumentVariables {
  id: string;
  payload: EmployeeDocumentUpdateInput;
}

export const useUpdateEmployeeKnowledgeDocumentMutation = (
  spaceId: string,
  options?: UseMutationOptions<KnowledgeDocumentItem, unknown, UpdateEmployeeDocumentVariables>,
): UseMutationResult<KnowledgeDocumentItem, unknown, UpdateEmployeeDocumentVariables> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, payload }: UpdateEmployeeDocumentVariables) =>
      updateEmployeeKnowledgeDocument(id, payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries(knowledgeKeys.employeeDocuments(spaceId));
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useArchiveEmployeeKnowledgeDocumentMutation = (
  spaceId: string,
  options?: UseMutationOptions<KnowledgeDocumentItem, unknown, string>,
): UseMutationResult<KnowledgeDocumentItem, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => archiveEmployeeKnowledgeDocument(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(knowledgeKeys.employeeDocuments(spaceId));
      options?.onSuccess?.(data, variables, context);
    },
  });
};

export const useDeleteEmployeeKnowledgeDocumentMutation = (
  spaceId: string,
  options?: UseMutationOptions<void, unknown, string>,
): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => deleteEmployeeKnowledgeDocument(id), {
    ...options,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries(knowledgeKeys.employeeDocuments(spaceId));
      options?.onSuccess?.(data, variables, context);
    },
  });
};

interface UploadEmployeeDocumentVariables {
  spaceId: string;
  payload: EmployeeDocumentUploadInput;
  /** Позволяет диалогу загрузки отличить «браузер ещё отправляет файл» от «сервер обрабатывает документ». */
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
}

export const useUploadEmployeeKnowledgeDocumentMutation = (
  options?: UseMutationOptions<KnowledgeDocumentItem, unknown, UploadEmployeeDocumentVariables>,
): UseMutationResult<KnowledgeDocumentItem, unknown, UploadEmployeeDocumentVariables> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ spaceId, payload, onUploadProgress }: UploadEmployeeDocumentVariables) =>
      uploadEmployeeKnowledgeDocument(spaceId, payload, onUploadProgress),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries(knowledgeKeys.employeeDocuments(variables.spaceId));
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};
