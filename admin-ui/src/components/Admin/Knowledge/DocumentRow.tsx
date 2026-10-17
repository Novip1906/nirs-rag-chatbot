import { IconButton, TableCell, TableRow, TableRowHeader, Tag } from '@librechat/client';
import { Archive, RefreshCw, Trash2 } from 'lucide-react';
import type { KnowledgeDocumentItem, KnowledgeDocumentStatus } from '~/api';
import { displayUserName, formatDate } from '~/components/Admin/common/insightsKit';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';

const STATUS_TAG: Record<
  KnowledgeDocumentStatus,
  { variant: 'success' | 'info' | 'error'; labelKey: TranslationKeys }
> = {
  active: { variant: 'success', labelKey: 'com_admin_knowledge_status_active' },
  draft: { variant: 'info', labelKey: 'com_admin_knowledge_status_draft' },
  archived: { variant: 'error', labelKey: 'com_admin_knowledge_status_archived' },
};

interface DocumentRowProps {
  document: KnowledgeDocumentItem;
  locale: string;
  onReplace: (document: KnowledgeDocumentItem) => void;
  onArchive: (document: KnowledgeDocumentItem) => void;
  onDelete: (document: KnowledgeDocumentItem) => void;
}

export default function DocumentRow({
  document,
  locale,
  onReplace,
  onArchive,
  onDelete,
}: DocumentRowProps): JSX.Element {
  const localize = useLocalize();
  const statusTag = STATUS_TAG[document.status];

  return (
    <TableRow data-status={document.status}>
      <TableRowHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-text-primary">{document.title}</p>
            {/*
              `embedded` — техническое состояние индексации, а не решение администратора
              о жизненном цикле документа (это `status`), поэтому не смешиваем их в одной
              колонке: документ виден в списке как обычный, но пуст в поиске по чату, пока
              его не переиндексируют — пометка рядом с названием держит это у самой
              причины сбоя, а не в отдельной почти всегда пустой колонке.
            */}
            {!document.embedded && (
              <Tag
                variant="warning"
                label={localize('com_admin_knowledge_document_not_indexed')}
                title={localize('com_admin_knowledge_document_not_indexed_hint')}
              />
            )}
          </div>
          <p className="truncate text-xs text-text-secondary">{document.filename}</p>
        </div>
      </TableRowHeader>
      <TableCell>{document.version !== '' ? document.version : '—'}</TableCell>
      <TableCell>
        {document.effectiveDate != null ? formatDate(document.effectiveDate, locale) : '—'}
      </TableCell>
      <TableCell>{document.owner !== '' ? document.owner : '—'}</TableCell>
      {/*
        Имя загрузившего разрешает сервер (одним пакетным запросом на страницу
        документов, а не по одному на строку) — здесь остаётся только отобразить
        его с тем же фолбэком, что на соседних экранах (расходы, запросы лимитов).
      */}
      <TableCell>
        {displayUserName(document.uploadedByName ?? '', localize('com_insights_unknown_user'))}
      </TableCell>
      <TableCell>
        <Tag variant={statusTag.variant} label={localize(statusTag.labelKey)} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <IconButton
            label={localize('com_admin_knowledge_document_replace')}
            size="sm"
            onClick={() => onReplace(document)}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </IconButton>
          {document.status === 'active' && (
            <IconButton
              label={localize('com_admin_knowledge_document_archive')}
              size="sm"
              onClick={() => onArchive(document)}
            >
              <Archive className="size-4" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={localize('com_admin_knowledge_document_delete')}
            size="sm"
            onClick={() => onDelete(document)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </TableCell>
    </TableRow>
  );
}
