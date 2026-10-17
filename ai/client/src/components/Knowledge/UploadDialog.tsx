import { useEffect, useId, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  SelectDropDown,
  Spinner,
  Textarea,
  useToastContext,
} from '@librechat/client';
import type { AxiosProgressEvent } from 'axios';
import type { Option } from '@librechat/client';
import type { KnowledgeSpaceSummary } from 'librechat-data-provider';
import {
  useEmployeeDocumentsQuery,
  useUploadEmployeeKnowledgeDocumentMutation,
} from '~/data-provider/Knowledge';
import { useLocalize } from '~/hooks';
import {
  KNOWLEDGE_DOCUMENT_ACCEPT,
  resolveUploadErrorMessage,
  validateSelectedFile,
} from './uploadErrors';

const MAX_DESCRIPTION_LENGTH = 200;

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Полный список пространств — фильтруется на доступные для записи внутри диалога. */
  spaces: KnowledgeSpaceSummary[];
  defaultSpaceId: string;
  /** Заполняются кнопкой «Загрузить новую версию» на строке документа. */
  initialTitle?: string;
  initialSupersedesId?: string;
}

function stripExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

/**
 * `toISOString` берёт дату по UTC: сотруднику в московском часовом поясе между
 * полуночью и тремя часами ночи подставило бы вчерашнее число незаметно для него.
 * Здесь дата собирается из локальных геттеров, поэтому совпадает с календарной
 * датой в часовом поясе сотрудника.
 */
function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const EMPTY_SPACE_OPTION: Option = { label: '', value: '' };

export default function UploadDialog({
  open,
  onOpenChange,
  spaces,
  defaultSpaceId,
  initialTitle,
  initialSupersedesId,
}: UploadDialogProps) {
  const localize = useLocalize();
  const formId = useId();
  const { showToast } = useToastContext();

  const writableSpaces = useMemo(() => spaces.filter((space) => space.canWrite), [spaces]);
  const spaceOptions = useMemo<Option[]>(
    () => writableSpaces.map((space) => ({ label: space.name, value: space.id })),
    [writableSpaces],
  );

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /**
   * `uploading` — браузер ещё отправляет файл (`onUploadProgress` следит за этим);
   * `processing` — байты уже ушли, а ответ ещё не пришёл: сервер извлекает текст и
   * индексирует документ синхронно в рамках того же запроса, отдельного статуса
   * «идёт обработка» на документе для этого не существует (см. `ingestDocument`).
   */
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [selectedSpace, setSelectedSpace] = useState<Option>(EMPTY_SPACE_OPTION);
  /**
   * Решение о совпадении названия хранится вместе с ID документа, к которому оно
   * относится: и `supersedesId`, и «показывать ли подсказку» ниже выводятся из этой
   * пары и текущего `matchedDocument`, без отдельного эффекта сброса. Отдельный
   * эффект здесь дал бы гонку при монтировании: эффект инициализации названия и
   * эффект сброса supersedesId применились бы в одном флаше, и второй увидел бы ещё
   * не обновлённый `title` из первого рендера и затёр бы предзаполненный supersedesId
   * значением null раньше, чем компонент успел бы перерендериться с новым названием.
   */
  const [matchResolution, setMatchResolution] = useState<{
    documentId: string;
    supersede: boolean;
  } | null>(
    initialSupersedesId != null ? { documentId: initialSupersedesId, supersede: true } : null,
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const initialSpace =
      writableSpaces.find((space) => space.id === defaultSpaceId) ?? writableSpaces[0];
    setFile(null);
    setFileError(null);
    setUploadPhase('idle');
    setTitle(initialTitle ?? '');
    setDescription('');
    setEffectiveDate(todayInputValue());
    setSelectedSpace(
      initialSpace != null
        ? { label: initialSpace.name, value: initialSpace.id }
        : EMPTY_SPACE_OPTION,
    );
    setMatchResolution(
      initialSupersedesId != null ? { documentId: initialSupersedesId, supersede: true } : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSpaceId, initialTitle, initialSupersedesId]);

  const spaceId = typeof selectedSpace.value === 'string' ? selectedSpace.value : '';
  /**
   * Документы выбранного (а не первоначального) пространства — из того же запроса,
   * которым их получает список документов. Ключ запроса параметризован
   * пространством: при смене выбора данные подтянутся сами, а для уже открытого
   * пространства придут из кэша без сетевого запроса — отдельного запроса тут нет.
   */
  const documentsQuery = useEmployeeDocumentsQuery(spaceId || null);
  const documents = documentsQuery.data;

  const matchedDocument = useMemo(() => {
    const normalized = title.trim().toLowerCase();
    if (normalized === '' || documents == null) {
      return null;
    }
    return documents.find((doc) => doc.title.trim().toLowerCase() === normalized) ?? null;
  }, [title, documents]);

  const isMatchResolved =
    matchedDocument != null && matchResolution?.documentId === matchedDocument.id;
  const showMatchPrompt = matchedDocument != null && !isMatchResolved;
  const supersedesId =
    isMatchResolved && matchResolution?.supersede === true ? (matchedDocument?.id ?? null) : null;

  const uploadMutation = useUploadEmployeeKnowledgeDocumentMutation({
    onSuccess: () => {
      setUploadPhase('idle');
      showToast({ status: 'success', message: localize('com_knowledge_document_uploaded') });
      onOpenChange(false);
    },
    onError: (error) => {
      setUploadPhase('idle');
      showToast({ status: 'error', message: resolveUploadErrorMessage(error, localize) });
    },
  });

  /**
   * `open` закрывается не только по кнопке «Отмена» — Radix зовёт `onOpenChange`
   * и на Escape, и на клик по оверлею. Пока идёт отправка, закрытие любым из этих
   * путей просто игнорируется, чтобы сотрудник случайно не прервал долгую
   * обработку документа.
   */
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploadMutation.isLoading) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleUploadProgress = (progressEvent: AxiosProgressEvent) => {
    if (progressEvent.total != null && progressEvent.loaded >= progressEvent.total) {
      setUploadPhase('processing');
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (selected == null) {
      setFile(null);
      setFileError(null);
      return;
    }

    const validationError = validateSelectedFile(selected, localize);
    if (validationError != null) {
      setFile(null);
      setFileError(validationError);
      event.target.value = '';
      return;
    }

    setFile(selected);
    setFileError(null);
    if (title.trim() === '') {
      setTitle(stripExtension(selected.name));
    }
  };

  const handleReplace = () => {
    if (matchedDocument == null) {
      return;
    }
    setMatchResolution({ documentId: matchedDocument.id, supersede: true });
  };

  const handleSaveSeparately = () => {
    if (matchedDocument == null) {
      return;
    }
    setMatchResolution({ documentId: matchedDocument.id, supersede: false });
  };

  const trimmedTitle = title.trim();
  const canSubmit =
    file != null && fileError == null && trimmedTitle !== '' && spaceId !== '' && !showMatchPrompt;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || file == null) {
      return;
    }
    setUploadPhase('uploading');
    uploadMutation.mutate({
      spaceId,
      payload: {
        file,
        title: trimmedTitle,
        description: description.trim() === '' ? undefined : description.trim(),
        effectiveDate: effectiveDate === '' ? null : effectiveDate,
        supersedesId: supersedesId ?? undefined,
      },
      onUploadProgress: handleUploadProgress,
    });
  };

  return (
    <OGDialog open={open} onOpenChange={handleDialogOpenChange}>
      <OGDialogTemplate
        title={localize('com_knowledge_upload_document_title')}
        className="w-11/12 max-w-md"
        showCloseButton={false}
        showCancelButton={!uploadMutation.isLoading}
        main={
          <form id={formId} onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-file`}>
                {localize('com_knowledge_upload_file_label')}
              </Label>
              <Input
                id={`${formId}-file`}
                type="file"
                accept={KNOWLEDGE_DOCUMENT_ACCEPT}
                onChange={handleFileChange}
              />
              {fileError != null && (
                <span role="alert" className="text-sm text-text-destructive">
                  {fileError}
                </span>
              )}
            </div>
            {writableSpaces.length > 1 && (
              <div className="grid w-full items-center gap-2">
                <SelectDropDown
                  title={localize('com_knowledge_upload_space_label')}
                  value={selectedSpace}
                  setValue={(value) => setSelectedSpace(value as Option)}
                  availableValues={spaceOptions}
                  containerClassName="w-full"
                  subContainerClassName="w-full"
                />
              </div>
            )}
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-title`}>
                {localize('com_knowledge_document_title_label')}
              </Label>
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>
            {showMatchPrompt && matchedDocument != null && (
              <div className="flex flex-col gap-2 rounded-lg border border-border-medium bg-surface-secondary p-3">
                <p className="text-sm text-text-primary">
                  {localize('com_knowledge_upload_duplicate_prompt', {
                    title: matchedDocument.title,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleSaveSeparately}>
                    {localize('com_knowledge_upload_save_separately_button')}
                  </Button>
                  <Button type="button" variant="submit" onClick={handleReplace}>
                    {localize('com_knowledge_upload_replace_button')}
                  </Button>
                </div>
              </div>
            )}
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-effective-date`}>
                {localize('com_knowledge_document_effective_date_label')}
              </Label>
              <Input
                id={`${formId}-effective-date`}
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
            <div className="grid w-full items-center gap-2">
              <Label htmlFor={`${formId}-description`}>{localize('com_ui_description')}</Label>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
            {uploadMutation.isLoading && (
              <p role="status" className="text-sm text-text-secondary">
                {localize('com_knowledge_upload_processing_hint')}
              </p>
            )}
          </form>
        }
        buttons={
          <Button
            type="submit"
            form={formId}
            variant="submit"
            disabled={!canSubmit || uploadMutation.isLoading}
          >
            {uploadMutation.isLoading ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" />
                {uploadPhase === 'processing'
                  ? localize('com_knowledge_upload_processing_button')
                  : localize('com_knowledge_upload_uploading_button')}
              </span>
            ) : (
              localize('com_ui_save')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
