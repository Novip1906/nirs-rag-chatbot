import { useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  KnowledgeDocumentInput,
  KnowledgeDocumentItem,
  KnowledgeReindexResponse,
  KnowledgeSpaceInput,
  KnowledgeSpaceItem,
} from '~/api';
import {
  createKnowledgeSpace,
  deleteKnowledgeDocument,
  deleteKnowledgeSpace,
  reindexKnowledgeSpace,
  updateKnowledgeDocument,
  updateKnowledgeSpace,
  uploadKnowledgeDocument,
} from './request';
import { getAdminErrorMessage } from '~/components/Admin/utils/format';
import { useLocalize } from '~/hooks';
import { knowledgeKeys } from './keys';

export const useCreateSpaceMutation = (): UseMutationResult<
  KnowledgeSpaceItem,
  unknown,
  KnowledgeSpaceInput
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation((payload: KnowledgeSpaceInput) => createKnowledgeSpace(payload), {
    onSuccess: () => {
      queryClient.invalidateQueries(knowledgeKeys.spaces);
      showToast({ message: localize('com_admin_toast_knowledge_space_created'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useUpdateSpaceMutation = (): UseMutationResult<
  KnowledgeSpaceItem,
  unknown,
  { id: string; payload: Partial<KnowledgeSpaceInput> }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id, payload }) => updateKnowledgeSpace(id, payload), {
    onSuccess: () => {
      queryClient.invalidateQueries(knowledgeKeys.spaces);
      showToast({ message: localize('com_admin_toast_knowledge_space_updated'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useDeleteSpaceMutation = (): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation((id: string) => deleteKnowledgeSpace(id), {
    onSuccess: () => {
      queryClient.invalidateQueries(knowledgeKeys.spaces);
      showToast({ message: localize('com_admin_toast_knowledge_space_deleted'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useUploadDocumentMutation = (): UseMutationResult<
  KnowledgeDocumentItem,
  unknown,
  { spaceId: string; file: File; metadata: KnowledgeDocumentInput }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(
    ({ spaceId, file, metadata }) => uploadKnowledgeDocument(spaceId, file, metadata),
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries(knowledgeKeys.documents(variables.spaceId));
        /** Upload changes the space's document count, shown in `SpacesView`. */
        queryClient.invalidateQueries(knowledgeKeys.spaces);
        showToast({
          message: localize('com_admin_toast_knowledge_document_uploaded'),
          status: 'success',
        });
      },
      onError: (error) => {
        showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
      },
    },
  );
};

export const useUpdateDocumentMutation = (): UseMutationResult<
  KnowledgeDocumentItem,
  unknown,
  { id: string; spaceId: string; payload: Partial<KnowledgeDocumentInput> }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id, payload }) => updateKnowledgeDocument(id, payload), {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries(knowledgeKeys.documents(variables.spaceId));
      showToast({
        message: localize('com_admin_toast_knowledge_document_updated'),
        status: 'success',
      });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useDeleteDocumentMutation = (): UseMutationResult<
  void,
  unknown,
  { id: string; spaceId: string }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id }) => deleteKnowledgeDocument(id), {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries(knowledgeKeys.documents(variables.spaceId));
      /** Deletion changes the space's document count, shown in `SpacesView`. */
      queryClient.invalidateQueries(knowledgeKeys.spaces);
      showToast({
        message: localize('com_admin_toast_knowledge_document_deleted'),
        status: 'success',
      });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

/**
 * Раньше показывала статичное «Переиндексация запущена.», не заглядывая в ответ —
 * обработчик на бэкенде синхронный (ждёт каждый документ в цикле) и уже к моменту
 * ответа знает, сколько документов реально переиндексировано и сколько пропущено.
 * Без пропусков — обычный успех; хотя бы один пропуск — предупреждение с числом
 * пропущенных, а сам список с причинами показывает страница пространства.
 */
export function buildReindexToastMessage(
  data: KnowledgeReindexResponse,
  localize: ReturnType<typeof useLocalize>,
): { message: string; status: 'success' | 'warning' } {
  if (data.skipped.length === 0) {
    return {
      message: localize('com_admin_toast_knowledge_space_reindexed', { count: data.reindexed }),
      status: 'success',
    };
  }
  return {
    message: localize('com_admin_toast_knowledge_space_reindexed_partial', {
      reindexed: data.reindexed,
      skipped: data.skipped.length,
    }),
    status: 'warning',
  };
}

export const useReindexSpaceMutation = (): UseMutationResult<
  KnowledgeReindexResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation((spaceId: string) => reindexKnowledgeSpace(spaceId), {
    onSuccess: (data, spaceId) => {
      queryClient.invalidateQueries(knowledgeKeys.documents(spaceId));
      showToast(buildReindexToastMessage(data, localize));
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};
