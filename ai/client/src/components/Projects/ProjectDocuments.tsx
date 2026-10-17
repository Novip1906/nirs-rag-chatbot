import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { allocateDocuments, PROJECT_CONTEXT_BUDGETS } from 'librechat-data-provider';
import { Button, Spinner } from '@librechat/client';
import type { ChangeEvent } from 'react';
import type { ProjectDocumentSummary, TProjectDocument } from 'librechat-data-provider';
import {
  KNOWLEDGE_DOCUMENT_ACCEPT,
  resolveUploadErrorMessage,
  validateSelectedFile,
} from '~/components/Knowledge/uploadErrors';
import {
  useDeleteProjectDocumentMutation,
  useProjectDocumentsQuery,
  useReindexProjectDocumentMutation,
  useUploadProjectDocumentMutation,
} from '~/data-provider/Projects/documents';
import { useLocalize } from '~/hooks';

interface ProjectDocumentsProps {
  projectId: string;
}

type DocumentMode = 'inline' | 'search';

interface UploadFailure {
  fileName: string;
  message: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Режим не хранится в базе — он результат бюджета, который пересчитывается на
 * каждый запрос модели. Клиент обязан считать его той же функцией, что и
 * сервер (`allocateDocuments`), иначе плашка обманет сотрудника: `text` для
 * распределения не нужен, им пользуется только раскладка «начал» документов
 * в поиске, которая на клиенте не отображается.
 */
function resolveDocumentModes(documents: TProjectDocument[]): Map<string, DocumentMode> {
  const summaries: ProjectDocumentSummary[] = documents.map((document) => ({
    fileId: document.fileId,
    title: document.title,
    tokenCount: document.tokenCount,
    text: '',
    embedded: document.embedded,
  }));
  const allocation = allocateDocuments(summaries, PROJECT_CONTEXT_BUDGETS);
  const modes = new Map<string, DocumentMode>();
  allocation.inline.forEach((document) => modes.set(document.fileId, 'inline'));
  allocation.searchable.forEach((document) => modes.set(document.fileId, 'search'));
  return modes;
}

export default function ProjectDocuments({ projectId }: ProjectDocumentsProps) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFailures, setUploadFailures] = useState<UploadFailure[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { data, isLoading } = useProjectDocumentsQuery(projectId);
  const uploadMutation = useUploadProjectDocumentMutation();
  const reindexMutation = useReindexProjectDocumentMutation();
  const deleteMutation = useDeleteProjectDocumentMutation();

  const documents = data?.documents ?? [];
  const modes = useMemo(() => resolveDocumentModes(data?.documents ?? []), [data?.documents]);

  const handleAddClick = () => fileInputRef.current?.click();

  /**
   * Сервер (`POST /api/projects/:id/documents`) принимает строго один файл на запрос
   * (`projectDocumentUpload.single('file')`), поэтому пачка выбранных файлов грузится
   * последовательно — по одному запросу на файл, а не параллельно и не одним запросом.
   * Причина отказа берётся из ответа сервера (`resolveUploadErrorMessage`), как это уже
   * сделано для загрузки в базу знаний, — общая строка скрывала бы, например, что файл
   * не прошёл проверку на скан или что формат не поддерживается.
   */
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    setIsUploading(true);
    const failures: UploadFailure[] = [];
    for (const file of files) {
      const validationError = validateSelectedFile(file, localize);
      if (validationError != null) {
        failures.push({ fileName: file.name, message: validationError });
        continue;
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      try {
        await uploadMutation.mutateAsync({ projectId, formData });
      } catch (error) {
        failures.push({ fileName: file.name, message: resolveUploadErrorMessage(error, localize) });
      }
    }
    setUploadFailures(failures);
    setIsUploading(false);
  };

  const handleDelete = (fileId: string) => {
    deleteMutation.mutate({ projectId, fileId });
  };

  const handleReindex = (fileId: string) => {
    reindexMutation.mutate({ projectId, fileId });
  };

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-text-primary">
        {localize('com_ui_project_documents')}
      </h2>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Spinner className="text-text-primary" />
        </div>
      )}

      {!isLoading && documents.length === 0 && (
        <p className="mb-3 text-sm text-text-secondary">
          {localize('com_ui_project_documents_empty')}
        </p>
      )}

      {!isLoading && documents.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {documents.map((document) => (
            <li
              key={document.fileId}
              className="flex items-center gap-3 rounded-2xl border border-border-light bg-surface-secondary px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {document.title}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                {formatBytes(document.bytes)}
              </span>
              <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                {modes.get(document.fileId) === 'search'
                  ? localize('com_ui_project_documents_mode_search')
                  : localize('com_ui_project_documents_mode_inline')}
              </span>
              {document.embedded ? null : (
                <>
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-warning"
                    title={localize('com_ui_project_documents_unindexed_hint')}
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {localize('com_ui_project_documents_unindexed')}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-text-secondary"
                    aria-label={localize('com_ui_project_documents_reindex')}
                    disabled={reindexMutation.isLoading}
                    onClick={() => handleReindex(document.fileId)}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-text-secondary hover:text-text-destructive"
                aria-label={localize('com_ui_project_documents_delete')}
                onClick={() => handleDelete(document.fileId)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={KNOWLEDGE_DOCUMENT_ACCEPT}
        className="hidden"
        aria-label={localize('com_ui_project_documents_add')}
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddClick}
        disabled={isUploading}
        className="gap-1.5"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {localize('com_ui_project_documents_add')}
      </Button>

      {uploadFailures.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {uploadFailures.map((failure) => (
            <li key={failure.fileName} className="text-sm text-text-destructive">
              {failure.fileName}: {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
