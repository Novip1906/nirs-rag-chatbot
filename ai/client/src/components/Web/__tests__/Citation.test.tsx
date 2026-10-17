import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Tools } from 'librechat-data-provider';
import type { SearchResultData, TAttachment } from 'librechat-data-provider';
import { Citation, CompositeCitation } from '~/components/Web/Citation';
import { useSearchResultsByTurn } from '~/hooks/Messages/useSearchResultsByTurn';
import { CitationContext } from '~/components/Web/Context';
import { SearchContext } from '~/Providers';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    if (key === 'com_citation_source') {
      return 'Source';
    }
    if (key === 'com_citation_more_details') {
      return `More details about ${values?.label ?? ''}`;
    }
    if (key === 'com_ui_relevance') {
      return 'Relevance';
    }
    if (key === 'com_file_pages') {
      return `Pages: ${values?.pages ?? ''}`;
    }
    if (key === 'com_file_source') {
      return 'File source';
    }
    if (key === 'com_citation_document_version') {
      return `Version ${values?.version ?? ''}`;
    }
    if (key === 'com_citation_document_effective_date') {
      return `Effective as of ${values?.date ?? ''}`;
    }
    if (key === 'com_citation_document_owner') {
      return `Owner: ${values?.owner ?? ''}`;
    }
    if (key === 'com_file_unknown') {
      return 'Unknown file';
    }
    return key;
  },
}));

jest.mock('~/components/Chat/Messages/Content/FilePreviewDialog', () => ({
  __esModule: true,
  default: ({
    open,
    fileId,
    fileName,
    fileSource,
  }: {
    open: boolean;
    fileId?: string;
    fileName: string;
    fileSource?: string;
  }) =>
    open ? (
      <div data-testid="file-preview-dialog" data-file-id={fileId} data-file-source={fileSource}>
        {fileName}
      </div>
    ) : null,
}));

jest.mock('~/components/Chat/Messages/Content/KnowledgeDocumentDialog', () => ({
  __esModule: true,
  default: ({
    open,
    fileId,
    title,
    spaceName,
    version,
    effectiveDate,
  }: {
    open: boolean;
    fileId: string;
    title: string;
    spaceName?: string;
    version?: string;
    effectiveDate?: string;
  }) =>
    open ? (
      <div
        data-testid="knowledge-document-dialog"
        data-file-id={fileId}
        data-space-name={spaceName}
        data-version={version}
        data-effective-date={effectiveDate}
      >
        {title}
      </div>
    ) : null,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

function renderWithProviders(
  children: React.ReactNode,
  searchResults: Record<string, SearchResultData>,
) {
  return render(
    <SearchContext.Provider value={{ searchResults }}>
      <CitationContext.Provider
        value={{
          hoveredCitationId: null,
          setHoveredCitationId: jest.fn(),
        }}
      >
        {children}
      </CitationContext.Provider>
    </SearchContext.Provider>,
  );
}

describe('Citation', () => {
  it('renders composite file citations as buttons and opens the preview dialog', () => {
    const searchResults = {
      '0': {
        references: [
          {
            attribution: 'Tutorial Imazing.pdf',
            fileId: 'file-123',
            fileName: 'Tutorial Imazing.pdf',
            link: '#file-123',
            metadata: {
              fileBytes: 2048,
              fileType: 'application/pdf',
              storageType: 'text',
            },
            pageRelevance: { 1: 0.92 },
            pages: [1],
            relevance: 0.92,
            title: 'Tutorial Imazing.pdf',
            type: 'file',
          },
        ],
      },
    };

    renderWithProviders(
      <CompositeCitation
        node={{
          properties: {
            citationId: 'cite-1',
            citations: [{ turn: 0, refType: 'file', index: 0 }],
          },
        }}
      />,
      searchResults as any,
    );

    const fileButton = screen.getByRole('button', { name: 'Tutorial Imazing.pdf' });

    expect(fileButton).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tutorial Imazing.pdf' })).not.toBeInTheDocument();

    fireEvent.click(fileButton);

    expect(screen.getByTestId('file-preview-dialog')).toHaveAttribute('data-file-id', 'file-123');
    expect(screen.getByTestId('file-preview-dialog')).toHaveAttribute('data-file-source', 'text');
  });

  it('renders nothing for a composite citation made up only of knowledge documents', () => {
    const searchResults = {
      '0': {
        references: [
          {
            fileId: 'kb-file-1',
            fileName: 'raw-filename.txt',
            docTitle: 'Положение об отпусках',
            type: 'file',
          },
          {
            fileId: 'kb-file-2',
            fileName: 'raw-filename-2.txt',
            docTitle: 'Регламент отпусков',
            type: 'file',
          },
        ],
      },
    };

    const { container } = renderWithProviders(
      <CompositeCitation
        node={{
          properties: {
            citationId: 'cite-kb-composite',
            citations: [
              { turn: 0, refType: 'file', index: 0 },
              { turn: 0, refType: 'file', index: 1 },
            ],
          },
        }}
      />,
      searchResults as any,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps standalone web citations as links', () => {
    const searchResults = {
      '0': {
        organic: [
          {
            attribution: 'example.com',
            link: 'https://example.com',
            snippet: 'Example snippet',
            title: 'Example',
          },
        ],
      },
    };

    renderWithProviders(
      <Citation
        citationId="cite-2"
        citationType="standalone"
        node={{
          properties: {
            citation: { turn: 0, refType: 'search', index: 0 },
            citationId: 'cite-2',
          },
        }}
      />,
      searchResults as any,
    );

    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });
});

/**
 * These tests exercise the real chain end to end: a `knowledge_search`
 * attachment (the shape `processFileCitations` actually emits) through the
 * real `useSearchResultsByTurn`, into `SearchContext`, into `Citation`.
 *
 * A knowledge-document citation renders nothing at the anchor's position: the
 * same document's title, space, version, and effective date are already shown
 * in the "Sources" block under the answer (`KnowledgeSources.tsx`), so the
 * inline hovercard card here would just duplicate it. An ordinary
 * attached-file citation (no `docTitle`) is unaffected and keeps the
 * hovercard, which is what the last test in this block checks.
 */
describe('Citation — knowledge_search anchors render nothing inline', () => {
  function knowledgeAttachment(source: Record<string, unknown>): TAttachment {
    return {
      type: Tools.file_search,
      [Tools.file_search]: { sources: [source] },
      messageId: 'message-1',
      toolCallId: 'tool-call-1',
    } as TAttachment;
  }

  function KnowledgeCitationHarness({ attachments }: { attachments: TAttachment[] }) {
    const searchResults = useSearchResultsByTurn(attachments) as Record<string, SearchResultData>;
    return (
      <SearchContext.Provider value={{ searchResults }}>
        <CitationContext.Provider
          value={{ hoveredCitationId: null, setHoveredCitationId: jest.fn() }}
        >
          <Citation
            citationId="cite-kb"
            citationType="standalone"
            node={{
              properties: {
                citation: { turn: 0, refType: 'file', index: 0 },
                citationId: 'cite-kb',
              },
            }}
          />
        </CitationContext.Provider>
      </SearchContext.Provider>
    );
  }

  function openHovercard(label: string): HTMLElement {
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`More details about ${label}`) }),
    );
    return screen.getByRole('dialog');
  }

  it('renders nothing in place of the anchor for a knowledge-document citation', () => {
    const { container } = render(
      <KnowledgeCitationHarness
        attachments={[
          knowledgeAttachment({
            fileId: 'kb-file-1',
            fileName: 'raw-filename.txt',
            docTitle: 'Положение об отпусках',
            spaceName: 'Кадры',
            version: '2.1',
            effectiveDate: '2026-03-14',
            owner: 'HR-отдел',
            relevance: 0.9,
          }),
        ]}
      />,
    );

    // No chip, no hovercard button, no dialog — the anchor simply collapses
    // to nothing, leaving no visible trace in the answer text.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Положение об отпусках')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-document-dialog')).not.toBeInTheDocument();
  });

  it('leaves an ordinary attached-file citation exactly as before (no docTitle field at all)', () => {
    render(
      <KnowledgeCitationHarness
        attachments={[
          knowledgeAttachment({
            fileId: 'plain-file-1',
            fileName: 'uploaded-report.pdf',
            relevance: 0.87,
            pages: [3],
          }),
        ]}
      />,
    );

    const dialog = openHovercard('uploaded-report.pdf');

    expect(within(dialog).getByText('uploaded-report.pdf')).toBeInTheDocument();
    // "Pages: 3" appears twice pre-fix and post-fix alike: once as the
    // generic-citation metadata line, once as the file reference's snippet
    // (`useSearchResultsByTurn` renders the page list into both). Asserting
    // the count, not just presence, is what would catch a knowledge-only
    // regression that duplicated content onto a plain file citation.
    expect(within(dialog).getAllByText('Pages: 3')).toHaveLength(2);
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Version/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Effective as of/)).not.toBeInTheDocument();
  });
});
