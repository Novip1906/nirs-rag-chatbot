import { useMemo, useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import { Link, useParams } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@librechat/client';
import { ArrowLeft, FileStack, Plus, RefreshCw } from 'lucide-react';
import type {
  KnowledgeDocumentInput,
  KnowledgeDocumentItem,
  KnowledgeReindexSkippedDocument,
} from '~/api';
import {
  useDeleteDocumentMutation,
  useKnowledgeDocumentsQuery,
  useKnowledgeSpacesQuery,
  useReindexSpaceMutation,
  useUpdateDocumentMutation,
  useUploadDocumentMutation,
} from '~/data-provider/Knowledge';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import DocumentUploadForm from './DocumentUploadForm';
import DocumentRow from './DocumentRow';
import { useCapabilities, useLocalize } from '~/hooks';

const ALL = 'all';
type StatusFilter = 'all' | 'active' | 'draft' | 'archived';

/** Дата без валидного парсинга не должна давать `NaN` в сравнении — тогда строка
 *  встаёт в произвольное место относительно соседей. Битая дата считается самой
 *  старой и уходит в конец списка, а не куда попало. */
function uploadTimeMs(createdAt: string): number {
  const parsed = new Date(createdAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function SpaceDocumentsPage(): JSX.Element {
  const { id: spaceId = '' } = useParams<{ id: string }>();
  const localize = useLocalize();
  const { locale } = useLocaleContext();
  const { capabilities } = useCapabilities();

  const spacesQuery = useKnowledgeSpacesQuery();
  const documentsQuery = useKnowledgeDocumentsQuery(spaceId);
  const uploadDocument = useUploadDocumentMutation();
  const updateDocument = useUpdateDocumentMutation();
  const deleteDocument = useDeleteDocumentMutation();
  const reindexSpace = useReindexSpaceMutation();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacingDocument, setReplacingDocument] = useState<KnowledgeDocumentItem | null>(null);
  const [deletingDocument, setDeletingDocument] = useState<KnowledgeDocumentItem | null>(null);
  /** Список последнего запуска переиндексации — тост исчезает сам, а с чем именно
   *  не справилась переиндексация, стоит увидеть не только в момент клика. */
  const [reindexSkipped, setReindexSkipped] = useState<KnowledgeReindexSkippedDocument[]>([]);

  const space = (spacesQuery.data ?? []).find((item) => item.id === spaceId);
  const documents = documentsQuery.data ?? [];

  /**
   * Новые загрузки сверху — это и есть «лента последних загрузок» для главы отдела:
   * отдельного экрана под неё не заводим, список документов пространства уже её роль.
   */
  const sortedByUpload = useMemo(
    () => [...documents].sort((a, b) => uploadTimeMs(b.createdAt) - uploadTimeMs(a.createdAt)),
    [documents],
  );

  /** Переиндексация — за `manage:configs`, тем же полномочием, что и управление
   *  пространствами: сервер закрывает её админ-уровнем роли, у главы отдела его нет. */
  const canManageConfigs = capabilities.has('manage:configs');

  const filtered = useMemo(
    () => sortedByUpload.filter((doc) => statusFilter === ALL || doc.status === statusFilter),
    [sortedByUpload, statusFilter],
  );
  const current = useMemo(
    () => filtered.filter((doc) => doc.status !== 'archived'),
    [filtered],
  );
  const archived = useMemo(() => filtered.filter((doc) => doc.status === 'archived'), [filtered]);

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/knowledge">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('com_admin_knowledge_back_to_list')}
      </Link>
    </Button>
  );

  const closeUploadForms = () => {
    setUploadOpen(false);
    setReplacingDocument(null);
  };

  const handleUpload = (file: File, metadata: KnowledgeDocumentInput) => {
    uploadDocument.mutate(
      {
        spaceId,
        file,
        metadata:
          replacingDocument != null
            ? { ...metadata, supersedesId: replacingDocument.id }
            : metadata,
      },
      { onSuccess: closeUploadForms },
    );
  };

  if (spacesQuery.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader
          title={localize('com_admin_knowledge_documents_title_loading')}
          action={backButton}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <LoadingState message={localize('com_admin_loading')} />
        </div>
      </div>
    );
  }

  if (spacesQuery.isError || space == null) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader
          title={localize('com_admin_knowledge_documents_title_loading')}
          action={backButton}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <AdminErrorState
            message={space == null ? localize('com_admin_knowledge_not_found') : undefined}
            onRetry={space == null ? undefined : () => spacesQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={space.name}
        description={localize('com_admin_knowledge_documents_description')}
        action={
          <div className="flex flex-wrap gap-2">
            {backButton}
            {canManageConfigs && (
              <Button
                variant="outline"
                onClick={() =>
                  reindexSpace.mutate(spaceId, {
                    onSuccess: (data) => setReindexSkipped(data.skipped),
                  })
                }
                disabled={reindexSpace.isLoading}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                {localize('com_admin_knowledge_reindex')}
              </Button>
            )}
            <Button
              variant="submit"
              onClick={() => {
                setReplacingDocument(null);
                setUploadOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_knowledge_upload')}
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {(uploadOpen || replacingDocument != null) && (
          <Panel className="mb-6">
            <DocumentUploadForm
              replacingTitle={replacingDocument?.title}
              isSaving={uploadDocument.isLoading}
              onCancel={closeUploadForms}
              onSubmit={handleUpload}
            />
          </Panel>
        )}

        {reindexSkipped.length > 0 && (
          <Panel className="mb-6 border-status-warning-border bg-status-warning-subtle">
            <p className="text-sm font-medium text-status-warning">
              {localize('com_admin_knowledge_reindex_skipped_title', {
                count: reindexSkipped.length,
              })}
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-text-secondary">
              {reindexSkipped.map((item, index) => (
                <li key={index}>
                  {localize('com_admin_knowledge_reindex_skipped_reason', {
                    title: item.title,
                    reason: item.reason,
                  })}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="mb-4 max-w-xs space-y-1.5">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-full" aria-label={localize('com_admin_knowledge_filter_status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{localize('com_admin_knowledge_filter_all')}</SelectItem>
              <SelectItem value="active">{localize('com_admin_knowledge_status_active')}</SelectItem>
              <SelectItem value="draft">{localize('com_admin_knowledge_status_draft')}</SelectItem>
              <SelectItem value="archived">
                {localize('com_admin_knowledge_status_archived')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {documentsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {documentsQuery.isError && <AdminErrorState onRetry={() => documentsQuery.refetch()} />}
        {!documentsQuery.isLoading && !documentsQuery.isError && filtered.length === 0 && (
          <EmptyState
            icon={FileStack}
            title={localize('com_admin_knowledge_documents_empty_title')}
            description={localize('com_admin_knowledge_documents_empty_description')}
          />
        )}

        {!documentsQuery.isLoading && !documentsQuery.isError && current.length > 0 && (
          <Panel className="mb-6 overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_knowledge_col_document')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_version')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_effective_date')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_owner')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_uploaded_by')}</TableHead>
                    <TableHead>{localize('com_admin_knowledge_col_status')}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">
                        {localize('com_admin_knowledge_col_actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      locale={locale}
                      onReplace={(doc) => {
                        setUploadOpen(false);
                        setReplacingDocument(doc);
                      }}
                      onArchive={(doc) =>
                        updateDocument.mutate({ id: doc.id, spaceId, payload: { status: 'archived' } })
                      }
                      onDelete={setDeletingDocument}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}

        {!documentsQuery.isLoading && !documentsQuery.isError && archived.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-medium text-text-secondary">
              {localize('com_admin_knowledge_documents_archived_section')}
            </h2>
            <Panel className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{localize('com_admin_knowledge_col_document')}</TableHead>
                      <TableHead>{localize('com_admin_knowledge_col_version')}</TableHead>
                      <TableHead>{localize('com_admin_knowledge_col_effective_date')}</TableHead>
                      <TableHead>{localize('com_admin_knowledge_col_owner')}</TableHead>
                      <TableHead>{localize('com_admin_knowledge_col_uploaded_by')}</TableHead>
                      <TableHead>{localize('com_admin_knowledge_col_status')}</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">
                          {localize('com_admin_knowledge_col_actions')}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archived.map((document) => (
                      <DocumentRow
                        key={document.id}
                        document={document}
                        locale={locale}
                        onReplace={(doc) => {
                          setUploadOpen(false);
                          setReplacingDocument(doc);
                        }}
                        onArchive={(doc) =>
                          updateDocument.mutate({
                            id: doc.id,
                            spaceId,
                            payload: { status: 'archived' },
                          })
                        }
                        onDelete={setDeletingDocument}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          </div>
        )}
      </div>
      <AlertDialog
        open={deletingDocument != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingDocument(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{localize('com_admin_knowledge_document_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {localize('com_admin_knowledge_document_delete_description', {
                title: deletingDocument?.title ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{localize('com_admin_action_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingDocument != null) {
                  deleteDocument.mutate({ id: deletingDocument.id, spaceId });
                  setDeletingDocument(null);
                }
              }}
            >
              {localize('com_admin_action_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
