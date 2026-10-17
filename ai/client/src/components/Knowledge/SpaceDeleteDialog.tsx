import { useNavigate, useParams } from 'react-router-dom';
import { OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { KnowledgeSpaceSummary } from 'librechat-data-provider';
import { useDeleteEmployeeSpaceMutation, useEmployeeSpacesQuery } from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';

interface SpaceDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: KnowledgeSpaceSummary;
}

/**
 * 409 (в пространстве остались документы) несёт число отдельным полем —
 * `packages/api/src/corporate/knowledge/employee.ts` (`deleteSpaceHandler`)
 * отдаёт его вместе с сырым текстом ошибки, чтобы здесь строился свой
 * локализованный текст, а не показывалось серверное сообщение как есть. Число
 * включает архивные документы — сервер намеренно не может «соврать» и вычесть
 * их, так что текст в `com_knowledge_space_delete_conflict` не уточняет статус.
 * Тот же приём чтения `error.response.data`, что и в `useMCPServerForm`. Для
 * остальных ошибок число не показывается: 403/500 и так не объясняются
 * пользователю конкретной причиной сервера.
 */
function readConflictDocumentCount(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as {
      response?: { status?: number; data?: { documentCount?: number } };
    };
    if (axiosError.response?.status === 409) {
      return axiosError.response.data?.documentCount;
    }
  }
  return undefined;
}

export default function SpaceDeleteDialog({ open, onOpenChange, space }: SpaceDeleteDialogProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const { showToast } = useToastContext();
  const spacesQuery = useEmployeeSpacesQuery();

  const deleteMutation = useDeleteEmployeeSpaceMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_knowledge_space_deleted') });
      onOpenChange(false);
      /** Удалённое пространство больше не в списке — если это был открытый раздел,
       *  выбор уходит на первый оставшийся, иначе просмотр остаётся без выбора. */
      if (spaceId === space.id) {
        const remaining = (spacesQuery.data ?? []).filter((item) => item.id !== space.id);
        navigate(remaining[0] != null ? `/knowledge/${remaining[0].id}` : '/knowledge');
      }
    },
    onError: (error) => {
      const documentCount = readConflictDocumentCount(error);
      showToast({
        status: 'error',
        message:
          documentCount != null
            ? localize('com_knowledge_space_delete_conflict', { count: documentCount })
            : localize('com_knowledge_space_delete_error'),
      });
    },
  });

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        showCloseButton={false}
        title={localize('com_knowledge_delete_space_title')}
        className="max-w-[450px]"
        main={
          <p className="text-left text-sm text-text-primary">
            {localize('com_knowledge_delete_space_confirm', { name: space.name })}
          </p>
        }
        selection={{
          selectHandler: () => deleteMutation.mutate(space.id),
          selectClasses:
            'bg-surface-destructive hover:bg-surface-destructive-hover transition-colors duration-200 text-white',
          selectText: localize('com_ui_delete'),
          isLoading: deleteMutation.isLoading,
        }}
      />
    </OGDialog>
  );
}
