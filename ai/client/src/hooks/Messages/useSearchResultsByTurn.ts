import { useMemo } from 'react';
import { TAttachment, Tools, SearchResultData } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

interface FileSource {
  fileId: string;
  fileName: string;
  /**
   * Stable per-answer document number set by `knowledge_search` (see
   * `DocumentCitationIndex` in `packages/api/src/corporate/knowledge/citations.ts`).
   * It is the `N` in the `turn0fileN` anchors the model writes, so it — not the
   * position in this array — decides where the source lands in `references`.
   * The generic `file_search` tool never sets it.
   */
  citationIndex?: number;
  pages?: number[];
  relevance?: number;
  pageRelevance?: Record<string, number>;
  metadata?: any;
  /**
   * Present only for `knowledge_search` sources (see `toKnowledgeDocumentSource`
   * in `api/app/clients/tools/util/knowledge.js`). An ordinary attached-file
   * citation from the generic `file_search` tool never sets these, so they
   * must stay optional here and flow through unchanged to `SourceHovercard`,
   * which uses `docTitle` as its knowledge-vs-generic switch.
   */
  docTitle?: string;
  spaceName?: string;
  version?: string;
  effectiveDate?: string;
  owner?: string;
}

interface DeduplicatedSource {
  fileId: string;
  fileName: string;
  citationIndex?: number;
  pages: number[];
  relevance: number;
  pageRelevance: Record<string, number>;
  metadata?: any;
  docTitle?: string;
  spaceName?: string;
  version?: string;
  effectiveDate?: string;
  owner?: string;
}

/**
 * The `file_search` attachment is typed as {@link SearchResultData} in the
 * shared schema, but at runtime the agent file-search tool emits a
 * `{ sources: FileSource[] }` payload. Read the sources defensively.
 */
type FileSearchAttachmentData = SearchResultData & { sources?: FileSource[] };

function getFileSearchSources(data: FileSearchAttachmentData): FileSource[] {
  return Array.isArray(data.sources) ? data.sources : [];
}

/**
 * The turn `knowledge_search` anchors always name. The agents runtime never
 * assigns a turn number (`runnableConfig.toolCall.turn` is set by no one), so
 * the backend cannot tell one search call from another and writes `turn0` in
 * every anchor. Knowledge documents are therefore gathered from all of an
 * answer's attachments into this single turn, and told apart by `citationIndex`.
 */
const KNOWLEDGE_TURN = '0';

function toFileReference(source: DeduplicatedSource, unknownLabel: string, pagesLabel: string) {
  /** A knowledge document is known by its title; only a plain attachment is known
   *  by its file name. Reaching for `fileName` first labelled every knowledge
   *  citation `merchant.pdf` instead of naming the regulation it came from. */
  const label = source.docTitle || source.fileName || unknownLabel;
  return {
    title: label,
    link: `#file-${source.fileId}`, // Create a pseudo-link for file references
    attribution: label, // Shown on the inline citation chip
    snippet: source.pages && source.pages.length > 0 ? pagesLabel : '', // Only page numbers for hover
    type: 'file' as const,
    // Store additional agent-specific data as properties on the reference
    fileId: source.fileId,
    fileName: source.fileName,
    pages: source.pages,
    pageRelevance: source.pageRelevance,
    metadata: source.metadata,
    // Knowledge-document requisites (see `FileSource` above) —
    // undefined for an ordinary attached-file citation.
    docTitle: source.docTitle,
    spaceName: source.spaceName,
    version: source.version,
    effectiveDate: source.effectiveDate,
    owner: source.owner,
  };
}

/** Merges a document met again in a later search call of the same answer. */
function mergeDocument(existing: DeduplicatedSource, incoming: DeduplicatedSource): void {
  const allPages = [...(existing.pages || []), ...(incoming.pages || [])];
  existing.pages = [...new Set(allPages)].sort((a, b) => a - b);
  existing.relevance = Math.max(existing.relevance || 0, incoming.relevance || 0);
  existing.pageRelevance = { ...existing.pageRelevance, ...incoming.pageRelevance };
}

/**
 * Hook that creates a map of turn numbers to SearchResultData from web search and agent file search attachments
 * @param attachments Array of attachment metadata
 * @returns A map of turn numbers to their corresponding search result data
 */
export function useSearchResultsByTurn(attachments?: TAttachment[]) {
  const localize = useLocalize();
  const searchResultsByTurn = useMemo(() => {
    const turnMap: { [key: string]: SearchResultData } = {};
    /** Knowledge documents of the whole answer, keyed by their `citationIndex`. */
    const knowledgeByIndex = new Map<number, DeduplicatedSource>();
    const hasKnowledge = (attachments ?? []).some(
      (attachment) =>
        attachment.type === Tools.file_search &&
        getFileSearchSources(
          (attachment[Tools.file_search] ?? {}) as FileSearchAttachmentData,
        ).some((source) => source.citationIndex != null),
    );
    /** Knowledge owns turn 0, so generic file-search attachments start after it. */
    let agentFileSearchTurn = hasKnowledge ? 1 : 0;

    attachments?.forEach((attachment) => {
      // Handle web search attachments (existing functionality)
      if (attachment.type === Tools.web_search && attachment[Tools.web_search]) {
        const searchData = attachment[Tools.web_search];
        if (searchData && typeof searchData.turn === 'number') {
          turnMap[searchData.turn.toString()] = searchData;
        }
      }

      // Handle agent file search attachments (following web search pattern)
      if (attachment.type === Tools.file_search && attachment[Tools.file_search]) {
        const sources = getFileSearchSources(attachment[Tools.file_search]);

        // Deduplicate sources by fileId and merge pages
        const deduplicatedSources = new Map<string, DeduplicatedSource>();

        sources.forEach((source: FileSource) => {
          const fileId = source.fileId;
          if (deduplicatedSources.has(fileId)) {
            // Merge pages for the same file
            const existing = deduplicatedSources.get(fileId);
            if (existing) {
              const existingPages = existing.pages || [];
              const newPages = source.pages || [];
              const allPages = [...existingPages, ...newPages];
              // Remove duplicates and sort
              const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);

              // Merge page relevance mappings
              const existingPageRelevance = existing.pageRelevance || {};
              const newPageRelevance = source.pageRelevance || {};
              const mergedPageRelevance = { ...existingPageRelevance, ...newPageRelevance };

              existing.pages = uniquePages;
              existing.relevance = Math.max(existing.relevance || 0, source.relevance || 0);
              existing.pageRelevance = mergedPageRelevance;
            }
          } else {
            deduplicatedSources.set(fileId, {
              fileId: source.fileId,
              fileName: source.fileName,
              citationIndex: source.citationIndex,
              pages: source.pages || [],
              relevance: source.relevance || 0.5,
              pageRelevance: source.pageRelevance || {},
              metadata: source.metadata,
              docTitle: source.docTitle,
              spaceName: source.spaceName,
              version: source.version,
              effectiveDate: source.effectiveDate,
              owner: source.owner,
            });
          }
        });

        const documents = Array.from(deduplicatedSources.values());
        const knowledge = documents.filter((document) => document.citationIndex != null);
        const generic = documents.filter((document) => document.citationIndex == null);

        for (const document of knowledge) {
          const index = document.citationIndex as number;
          const existing = knowledgeByIndex.get(index);
          if (existing == null) {
            knowledgeByIndex.set(index, document);
            continue;
          }
          mergeDocument(existing, document);
        }

        /** A call that found only knowledge documents contributes no turn of its own. */
        if (generic.length === 0 && knowledge.length > 0) {
          return;
        }

        // Convert agent file sources to SearchResultData format
        const agentSearchData: SearchResultData = {
          turn: agentFileSearchTurn,
          organic: [], // Agent file search doesn't have organic web results
          topStories: [], // No top stories for file search
          images: [], // No images for file search
          references: generic.map(
            (source) =>
              toFileReference(
                source,
                localize('com_file_unknown'),
                localize('com_file_pages', { pages: (source.pages ?? []).join(', ') }),
              ) as any,
          ),
        };

        turnMap[agentFileSearchTurn.toString()] = agentSearchData;
        agentFileSearchTurn++;
      }
    });

    /**
     * Placed by `citationIndex`, not by position: the model writes `turn0fileN`
     * with the number printed on the search-result card, and a gap in the
     * numbering must stay a gap so the stale anchor resolves to nothing and the
     * client strips it, rather than silently pointing at another document.
     */
    /**
     * One document behind the whole answer means the inline chips have nothing
     * left to tell apart: the same chip after every sentence repeats one fact
     * and breaks the text up for nothing. Dropping the turn leaves every
     * `turn0fileN` anchor unresolved, and an unresolved citation renders as
     * nothing — the answer reads clean while the "Sources" block underneath,
     * which reads the anchors out of the raw text rather than out of this map,
     * still names the document with its version and effective date.
     *
     * Two or more documents and the chips earn their place again: there they
     * say which claim came from which document, and nothing else does.
     */
    if (knowledgeByIndex.size > 1) {
      const highest = Math.max(...knowledgeByIndex.keys());
      const references = Array.from({ length: highest + 1 }, (_unused, index) => {
        const source = knowledgeByIndex.get(index);
        if (source == null) {
          return undefined;
        }
        return toFileReference(
          source,
          localize('com_file_unknown'),
          localize('com_file_pages', { pages: (source.pages ?? []).join(', ') }),
        );
      });
      turnMap[KNOWLEDGE_TURN] = {
        turn: Number(KNOWLEDGE_TURN),
        organic: [],
        topStories: [],
        images: [],
        references: references as any,
      };
    }

    return turnMap;
  }, [attachments, localize]);

  return searchResultsByTurn;
}
