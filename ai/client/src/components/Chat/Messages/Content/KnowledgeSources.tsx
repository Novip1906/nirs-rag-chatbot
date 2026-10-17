import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@librechat/client';
import type { TAttachment } from 'librechat-data-provider';
import type { KnowledgeSourceDocument } from '~/hooks/Messages/useKnowledgeSources';
import { useKnowledgeSources } from '~/hooks/Messages/useKnowledgeSources';
import { formatEffectiveDate } from './dates';
import KnowledgeDocumentDialog from './KnowledgeDocumentDialog';
import { useLocalize } from '~/hooks';

/** Documents beyond this count collapse behind a "show more" toggle. */
const VISIBLE_LIMIT = 3;

function KnowledgeSourceRow({
  document,
  onOpen,
}: {
  document: KnowledgeSourceDocument;
  onOpen: (document: KnowledgeSourceDocument) => void;
}) {
  const localize = useLocalize();
  const { i18n } = useTranslation();

  const metaParts = useMemo(() => {
    const parts: string[] = [];
    if (document.version) {
      parts.push(localize('com_citation_document_version', { version: document.version }));
    }
    if (document.effectiveDate) {
      const formatted = formatEffectiveDate(document.effectiveDate, i18n.language);
      if (formatted) {
        parts.push(localize('com_citation_document_effective_date', { date: formatted }));
      }
    }
    if (document.spaceName) {
      parts.push(document.spaceName);
    }
    return parts;
  }, [document.version, document.effectiveDate, document.spaceName, i18n.language, localize]);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(document)}
        aria-label={`${localize('com_knowledge_document_open')} ${document.title}`}
        className="flex w-full items-start justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{document.title}</p>
          {metaParts.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-text-secondary">{metaParts.join(' · ')}</p>
          )}
        </div>
      </button>
    </li>
  );
}

interface KnowledgeSourcesProps {
  attachments?: TAttachment[];
  /** The answer's own text, read for citation anchors. */
  answerText?: string;
}

/**
 * Numbers of the documents the model actually cited, taken from the
 * `turn0fileN` anchors in its answer. Both spellings are accepted for the same
 * reason the client's own parser accepts both: the instruction asks for the
 * literal escape, but a model may emit the U+E202 character instead.
 */
function citedIndices(answerText: string): Set<number> {
  const pattern = /(?:\\ue202|\ue202)turn\d+file(\d+)/g;
  const cited = new Set<number>();
  for (const match of answerText.matchAll(pattern)) {
    cited.add(Number(match[1]));
  }
  return cited;
}

/**
 * Narrows the block to what the answer leaned on.
 *
 * No fallback to "show everything found": an uncited answer, or a citation
 * whose index doesn't match any found document, leaves an empty list here, and
 * the caller's `documents.length === 0` check hides the block entirely rather
 * than overstate the sources by showing documents the answer never pointed to.
 */
function citedDocuments(
  documents: KnowledgeSourceDocument[],
  answerText: string,
): KnowledgeSourceDocument[] {
  const cited = citedIndices(answerText);
  if (cited.size === 0) {
    return [];
  }
  return documents.filter(
    (document) => document.citationIndex != null && cited.has(document.citationIndex),
  );
}

/**
 * Document-requisite list rendered under a message's last text part when it
 * drew on `knowledge_search`: one row per source document (title, version,
 * effective date, space), not the favicon cards `~/components/Web/Sources`
 * renders for web/generic-file citations — a knowledge document has no
 * favicon, and its identity is its title plus version/date, not a domain.
 * Clicking a row opens `KnowledgeDocumentDialog` for that document.
 */
export default function KnowledgeSources({ attachments, answerText }: KnowledgeSourcesProps) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const [openDocument, setOpenDocument] = useState<KnowledgeSourceDocument | null>(null);
  const { searched, documents: found } = useKnowledgeSources(attachments);
  const documents = useMemo(() => citedDocuments(found, answerText ?? ''), [found, answerText]);

  /**
   * Блок «Источники» без единого источника сотруднику ничего не даёт: сообщение о том,
   * что поиск ничего не нашёл, модель и так пишет в самом ответе, а пустая плашка под
   * ним выглядит как сбой.
   */
  if (!searched || documents.length === 0) {
    return null;
  }

  const visibleDocuments = expanded ? documents : documents.slice(0, VISIBLE_LIMIT);
  const remainingCount = documents.length - visibleDocuments.length;

  return (
    <div
      role="region"
      aria-label={localize('com_knowledge_sources_region_label')}
      className="mt-3 border-t border-border-light pt-3"
    >
      <h3 className="mb-2 text-xs font-medium text-text-secondary">
        {localize('com_sources_title')}
      </h3>
      <ul className="flex flex-col gap-2">
        {visibleDocuments.map((document) => (
          <KnowledgeSourceRow key={document.fileId} document={document} onOpen={setOpenDocument} />
        ))}
      </ul>
      {remainingCount > 0 && (
        <Button
          variant="link"
          onClick={() => setExpanded(true)}
          className="mt-2 h-auto p-0 text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          {localize('com_knowledge_sources_show_more', { count: remainingCount })}
        </Button>
      )}
      {openDocument && (
        <KnowledgeDocumentDialog
          open={openDocument != null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setOpenDocument(null);
            }
          }}
          fileId={openDocument.fileId}
          title={openDocument.title}
          spaceName={openDocument.spaceName}
          version={openDocument.version}
          effectiveDate={openDocument.effectiveDate}
        />
      )}
    </div>
  );
}
