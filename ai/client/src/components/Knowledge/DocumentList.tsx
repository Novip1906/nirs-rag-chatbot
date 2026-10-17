import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Eye, Pencil, Search, Trash2, UploadCloud } from 'lucide-react';
import { isAdminLevelRole, SystemRoles } from 'librechat-data-provider';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  TooltipAnchor,
  useToastContext,
} from '@librechat/client';
import type { KnowledgeDocumentItem, KnowledgeSpaceSummary } from 'librechat-data-provider';
import { formatEffectiveDate } from '~/components/Chat/Messages/Content/dates';
import KnowledgeDocumentDialog from '~/components/Chat/Messages/Content/KnowledgeDocumentDialog';
import {
  useArchiveEmployeeKnowledgeDocumentMutation,
  useDeleteEmployeeKnowledgeDocumentMutation,
} from '~/data-provider/Knowledge';
import { useAuthContext, useLocalize } from '~/hooks';
import EditKnowledgeDocumentDialog from './EditKnowledgeDocumentDialog';
import UploadDialog from './UploadDialog';

interface DocumentListProps {
  space: KnowledgeSpaceSummary;
  documents: KnowledgeDocumentItem[];
  isLoading: boolean;
  isError: boolean;
}

export default function DocumentList({ space, documents, isLoading, isError }: DocumentListProps) {
  const localize = useLocalize();
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  /**
   * Список пространства меняется, а состояние поиска и переключателя в этом
   * компоненте — нет (тот же `DocumentList`, просто с новыми `documents`): без
   * сброса запрос и «показать архивные», набранные в одном пространстве, молча
   * перешли бы в другое.
   */
  useEffect(() => {
    setSearchQuery('');
    setShowArchived(false);
  }, [space.id]);

  /**
   * `documents` уже приходит без архивных для того, кто не управляет
   * пространством (см. `KnowledgeView` — `includeArchived` серверу шлётся только
   * при `space.canManage`), так что фильтр здесь чисто для переключателя
   * управляющего, а не вторая линия защиты для чужого доступа.
   */
  const visibleDocuments = useMemo(
    () =>
      showArchived ? documents : documents.filter((document) => document.status !== 'archived'),
    [documents, showArchived],
  );

  const filteredDocuments = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (normalized === '') {
      return visibleDocuments;
    }
    return visibleDocuments.filter(
      (document) =>
        document.title.toLowerCase().includes(normalized) ||
        document.description.toLowerCase().includes(normalized),
    );
  }, [visibleDocuments, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-secondary" aria-label={localize('com_ui_loading')} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12 text-center">
        <p className="text-sm text-text-secondary">
          {localize('com_knowledge_documents_load_error')}
        </p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
        <h1 className="sr-only">{space.name}</h1>
        <p className="text-[15px] font-semibold text-text-primary">
          {localize('com_knowledge_no_documents_title')}
        </p>
        <p className="mt-1.5 text-sm text-text-secondary">
          {localize('com_knowledge_no_documents_description')}
        </p>
      </div>
    );
  }

  const allArchivedAndHidden = visibleDocuments.length === 0;

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="px-1 text-base font-semibold text-text-primary">{space.name}</h1>
      <div className="flex items-center gap-3 px-1">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={localize('com_knowledge_search_placeholder')}
            aria-label={localize('com_knowledge_search_label')}
            className="pl-9"
          />
        </div>
        {space.canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              id="knowledge-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label={localize('com_knowledge_show_archived')}
            />
            <Label
              htmlFor="knowledge-show-archived"
              className="cursor-pointer whitespace-nowrap text-sm text-text-secondary"
            >
              {localize('com_knowledge_show_archived')}
            </Label>
          </div>
        )}
      </div>
      {filteredDocuments.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-text-primary">
            {localize(
              allArchivedAndHidden
                ? 'com_knowledge_all_archived_title'
                : 'com_knowledge_no_search_results_title',
            )}
          </p>
          <p className="mt-1.5 text-sm text-text-secondary">
            {localize(
              allArchivedAndHidden
                ? 'com_knowledge_all_archived_description'
                : 'com_knowledge_no_search_results_description',
            )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filteredDocuments.map((document) => (
            <DocumentRow key={document.id} doc={document} space={space} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({ doc, space }: { doc: KnowledgeDocumentItem; space: KnowledgeSpaceSummary }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();

  const [showPreview, setShowPreview] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isArchived = doc.status === 'archived';
  const canManageForeign = isAdminLevelRole(user?.role) || user?.role === SystemRoles.HEAD;
  const canManageDocument = space.canWrite && (canManageForeign || doc.uploadedBy === user?.id);
  /**
   * Безвозвратное удаление — не то же самое, что `canManageDocument`: сервер
   * (`requireManageableSpace`) пускает только того, кто распоряжается пространством,
   * а не любого автора документа с правом записи, — иначе рядовой сотрудник получил
   * бы кнопку, которая всегда отвечает 403.
   */
  const canDeleteDocument = space.canManage;

  const archiveMutation = useArchiveEmployeeKnowledgeDocumentMutation(space.id, {
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_knowledge_document_archived') });
      setShowArchiveConfirm(false);
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_knowledge_document_archive_error') });
    },
  });

  const deleteMutation = useDeleteEmployeeKnowledgeDocumentMutation(space.id, {
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_knowledge_document_deleted') });
      setShowDeleteConfirm(false);
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_knowledge_document_delete_error') });
    },
  });

  const effectiveDateLabel = doc.effectiveDate
    ? formatEffectiveDate(doc.effectiveDate, i18n.language)
    : undefined;

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary p-3 transition-colors hover:bg-surface-hover">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium text-text-primary">{doc.title}</p>
          {isArchived && (
            <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary">
              {localize('com_knowledge_document_archived_badge')}
            </span>
          )}
        </div>
        {doc.description !== '' && (
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary">{doc.description}</p>
        )}
        {effectiveDateLabel != null && (
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_citation_document_effective_date', { date: effectiveDateLabel })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TooltipAnchor
          description={localize('com_ui_preview')}
          side="top"
          render={
            <Button
              type="button"
              variant="row-action"
              size="icon-sm"
              aria-label={`${localize('com_ui_preview')} ${doc.title}`}
              onClick={() => setShowPreview(true)}
            >
              <Eye className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        {canManageDocument && (
          <>
            <TooltipAnchor
              description={localize('com_ui_edit')}
              side="top"
              render={
                <Button
                  type="button"
                  variant="row-action"
                  size="icon-sm"
                  aria-label={`${localize('com_ui_edit')} ${doc.title}`}
                  onClick={() => setShowEdit(true)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            {!isArchived && (
              <TooltipAnchor
                description={localize('com_ui_archive')}
                side="top"
                render={
                  <Button
                    type="button"
                    variant="row-action"
                    size="icon-sm"
                    aria-label={`${localize('com_ui_archive')} ${doc.title}`}
                    onClick={() => setShowArchiveConfirm(true)}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
            )}
            <TooltipAnchor
              description={localize('com_knowledge_upload_new_version_button')}
              side="top"
              render={
                <Button
                  type="button"
                  variant="row-action"
                  size="icon-sm"
                  aria-label={`${localize('com_knowledge_upload_new_version_button')} ${doc.title}`}
                  onClick={() => setShowNewVersion(true)}
                >
                  <UploadCloud className="size-4" aria-hidden="true" />
                </Button>
              }
            />
          </>
        )}
        {canDeleteDocument && (
          <TooltipAnchor
            description={localize('com_ui_delete')}
            side="top"
            render={
              <Button
                type="button"
                variant="row-action"
                size="icon-sm"
                aria-label={`${localize('com_ui_delete')} ${doc.title}`}
                onClick={() => setShowDeleteConfirm(true)}
                className="hover:bg-surface-destructive hover:text-text-on-status"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        )}
      </div>

      <KnowledgeDocumentDialog
        open={showPreview}
        onOpenChange={setShowPreview}
        fileId={doc.fileId}
        title={doc.title}
        spaceName={space.name}
        effectiveDate={doc.effectiveDate ?? undefined}
      />

      {canManageDocument && (
        <EditKnowledgeDocumentDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          doc={doc}
          spaceId={space.id}
        />
      )}

      {canManageDocument && (
        <UploadDialog
          open={showNewVersion}
          onOpenChange={setShowNewVersion}
          spaces={[space]}
          defaultSpaceId={space.id}
          initialTitle={doc.title}
          initialSupersedesId={doc.id}
        />
      )}

      {canManageDocument && !isArchived && (
        <OGDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
          <OGDialogTemplate
            showCloseButton={false}
            title={localize('com_knowledge_archive_confirm_title')}
            className="max-w-[450px]"
            main={
              <p className="text-left text-sm text-text-primary">
                {localize('com_knowledge_archive_confirm_description', { title: doc.title })}
              </p>
            }
            selection={{
              selectHandler: () => archiveMutation.mutate(doc.id),
              selectClasses:
                'bg-surface-destructive hover:bg-surface-destructive-hover transition-colors duration-200 text-white',
              selectText: localize('com_ui_archive'),
              isLoading: archiveMutation.isLoading,
            }}
          />
        </OGDialog>
      )}

      {canDeleteDocument && (
        <OGDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <OGDialogTemplate
            showCloseButton={false}
            title={localize('com_knowledge_delete_document_confirm_title')}
            className="max-w-[450px]"
            main={
              <p className="text-left text-sm text-text-primary">
                {localize('com_knowledge_delete_document_confirm_description', {
                  title: doc.title,
                })}
              </p>
            }
            selection={{
              selectHandler: () => deleteMutation.mutate(doc.id),
              selectClasses:
                'bg-surface-destructive hover:bg-surface-destructive-hover transition-colors duration-200 text-white',
              selectText: localize('com_ui_delete'),
              isLoading: deleteMutation.isLoading,
            }}
          />
        </OGDialog>
      )}
    </li>
  );
}
