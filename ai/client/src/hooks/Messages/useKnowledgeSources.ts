import { useMemo } from 'react';
import { Tools } from 'librechat-data-provider';
import type { TAttachment, SearchResultData } from 'librechat-data-provider';

export interface KnowledgeSourceDocument {
  fileId: string;
  /**
   * The `N` of the `turn0fileN` anchors the model writes for this document,
   * assigned by `DocumentCitationIndex` on the server and stable for the whole
   * answer. Absent on sources produced before citation numbering existed.
   */
  citationIndex?: number;
  title: string;
  spaceName?: string;
  version?: string;
  effectiveDate?: string;
}

interface RawKnowledgeSource {
  fileId?: string;
  citationIndex?: number;
  fileName?: string;
  docTitle?: string;
  spaceName?: string;
  version?: string;
  effectiveDate?: string;
}

/**
 * The `file_search` attachment is typed as {@link SearchResultData} in the
 * shared schema, but at runtime `knowledge_search` (see
 * `api/app/clients/tools/util/knowledge.js`) emits a
 * `{ sources: RawKnowledgeSource[] }` payload sharing the same `Tools.file_search`
 * artifact key as the generic file-search tool. Read it defensively.
 */
type FileSearchArtifactData = SearchResultData & { sources?: RawKnowledgeSource[] };

/**
 * `docTitle` is the switch: only `knowledge_search` sets it (see
 * `toKnowledgeDocumentSource` in knowledge.js). An ordinary attached-file
 * citation from the ${Tools.file_search} tool never carries this key.
 */
function isKnowledgeSource(source: RawKnowledgeSource): source is RawKnowledgeSource & {
  fileId: string;
} {
  return Object.prototype.hasOwnProperty.call(source, 'docTitle') && Boolean(source.fileId);
}

export interface KnowledgeSourcesResult {
  /** True once a `knowledge_search` call is represented among the attachments,
   * whether or not it found any documents. Drives whether the sources block
   * renders at all. */
  searched: boolean;
  documents: KnowledgeSourceDocument[];
}

const EMPTY_RESULT: KnowledgeSourcesResult = { searched: false, documents: [] };

/**
 * Reduces `knowledge_search` artifacts on a message's attachments to one row
 * per document, for the "Sources" block rendered under the answer.
 *
 * `knowledge_search` and the generic `file_search` tool share the
 * `Tools.file_search` artifact key, so this reads attachments directly
 * instead of going through `useSearchResultsByTurn`/`SearchContext`: that
 * pipeline collapses web-search and file-search turns into one map keyed by
 * turn number, losing the per-attachment origin needed to tell a genuine
 * "knowledge_search found nothing" turn apart from a web-search turn that
 * simply has no file references. Reading `attachment.type` here, before any
 * such collapsing, keeps that distinction intact.
 *
 * A `knowledge_search` zero-hit call reaches the client as an attachment with
 * an empty `sources` array (see `processFileCitations` in
 * `api/server/services/Files/Citations/index.js`) — the generic tool never
 * produces an attachment at all when it has nothing to report, so an empty
 * array is unambiguous.
 */
export function useKnowledgeSources(attachments?: TAttachment[]): KnowledgeSourcesResult {
  return useMemo(() => {
    if (!attachments || attachments.length === 0) {
      return EMPTY_RESULT;
    }

    let searched = false;
    const documentsById = new Map<string, KnowledgeSourceDocument>();

    for (const attachment of attachments) {
      if (attachment.type !== Tools.file_search) {
        continue;
      }
      const artifact = attachment[Tools.file_search] as FileSearchArtifactData | undefined;
      const sources = artifact?.sources;
      if (!Array.isArray(sources)) {
        continue;
      }
      if (sources.length === 0) {
        searched = true;
        continue;
      }

      for (const source of sources) {
        if (!isKnowledgeSource(source)) {
          continue;
        }
        searched = true;
        if (documentsById.has(source.fileId)) {
          continue;
        }
        documentsById.set(source.fileId, {
          fileId: source.fileId,
          citationIndex: source.citationIndex,
          title: source.docTitle || source.fileName || '',
          spaceName: source.spaceName || undefined,
          version: source.version || undefined,
          effectiveDate: source.effectiveDate || undefined,
        });
      }
    }

    if (!searched) {
      return EMPTY_RESULT;
    }
    return { searched, documents: Array.from(documentsById.values()) };
  }, [attachments]);
}
