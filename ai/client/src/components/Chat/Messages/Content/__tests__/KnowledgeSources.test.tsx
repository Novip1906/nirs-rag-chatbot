import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { Tools } from 'librechat-data-provider';
import type { TAttachment } from 'librechat-data-provider';
import KnowledgeSources from '../KnowledgeSources';

jest.mock('../KnowledgeDocumentDialog', () => ({
  __esModule: true,
  default: ({ open, fileId, title }: { open: boolean; fileId: string; title: string }) =>
    open ? (
      <div data-testid="knowledge-document-dialog" data-file-id={fileId}>
        {title}
      </div>
    ) : null,
}));

function knowledgeAttachment(sources: Array<Record<string, unknown>>): TAttachment {
  return {
    type: Tools.file_search,
    [Tools.file_search]: { sources },
    messageId: 'message-1',
    toolCallId: 'tool-call-1',
  } as TAttachment;
}

/** Builds the literal-escape anchor the model is instructed to emit for a document number. */
function anchor(fileIndex: number): string {
  return `\\ue202turn0file${fileIndex}`;
}

describe('KnowledgeSources', () => {
  test('renders nothing when there are no attachments', () => {
    const { container } = render(<KnowledgeSources />);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing for an ordinary file_search attachment (no docTitle)', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'f1', fileName: 'uploaded.pdf', relevance: 0.9 }]),
    ];
    const { container } = render(<KnowledgeSources attachments={attachments} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when knowledge_search found nothing', () => {
    const attachments = [knowledgeAttachment([])];
    const { container } = render(<KnowledgeSources attachments={attachments} />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });

  test('renders title, version, effective date, and space for a cited document', () => {
    const attachments = [
      knowledgeAttachment([
        {
          fileId: 'f1',
          citationIndex: 0,
          fileName: 'raw.txt',
          docTitle: 'Vacation Policy',
          spaceName: 'Corporate Standards',
          version: '2.0',
          effectiveDate: '2026-03-14T00:00:00.000Z',
        },
      ]),
    ];
    render(<KnowledgeSources attachments={attachments} answerText={`Fact.${anchor(0)}`} />);

    expect(screen.getByText('Vacation Policy')).toBeInTheDocument();
    const meta = screen.getByText(/Version 2\.0/);
    expect(meta).toHaveTextContent('Version 2.0');
    expect(meta).toHaveTextContent('Corporate Standards');
    expect(meta).toHaveTextContent(/Effective as of/);
  });

  test('omits blank fields without leaving a dangling separator', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, fileName: 'raw.txt', docTitle: 'Bare Document' },
      ]),
    ];
    render(<KnowledgeSources attachments={attachments} answerText={`Fact.${anchor(0)}`} />);

    expect(screen.getByText('Bare Document')).toBeInTheDocument();
    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  test('clicking a source row opens the document dialog for that document', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, fileName: 'raw.txt', docTitle: 'Vacation Policy' },
        { fileId: 'f2', citationIndex: 1, fileName: 'other.txt', docTitle: 'Other Document' },
      ]),
    ];
    render(
      <KnowledgeSources
        attachments={attachments}
        answerText={`Fact one.${anchor(0)} Fact two.${anchor(1)}`}
      />,
    );

    expect(screen.queryByTestId('knowledge-document-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Vacation Policy/ }));

    const dialog = screen.getByTestId('knowledge-document-dialog');
    expect(dialog).toHaveAttribute('data-file-id', 'f1');
    expect(dialog).toHaveTextContent('Vacation Policy');
  });

  test('falls back to the filename when docTitle is blank', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, fileName: 'raw-filename.txt', docTitle: '' },
      ]),
    ];
    render(<KnowledgeSources attachments={attachments} answerText={`Fact.${anchor(0)}`} />);
    expect(screen.getByText('raw-filename.txt')).toBeInTheDocument();
  });

  test('collapses one row per document even when multiple fragments repeat it', () => {
    const attachments = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, docTitle: 'Same Document', fileName: 'a.txt' },
        { fileId: 'f1', citationIndex: 0, docTitle: 'Same Document', fileName: 'a.txt' },
      ]),
    ];
    render(<KnowledgeSources attachments={attachments} answerText={`Fact.${anchor(0)}`} />);
    expect(screen.getAllByText('Same Document')).toHaveLength(1);
  });

  test('shows the document whether the search found one document or several', () => {
    const singleDocument = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, docTitle: 'Solo Document', fileName: 'solo.pdf' },
      ]),
    ];
    const { unmount } = render(
      <KnowledgeSources attachments={singleDocument} answerText={`Fact.${anchor(0)}`} />,
    );
    expect(screen.getByText('Solo Document')).toBeInTheDocument();
    unmount();

    const twoDocuments = [
      knowledgeAttachment([
        { fileId: 'f1', citationIndex: 0, docTitle: 'First Document', fileName: 'a.pdf' },
        { fileId: 'f2', citationIndex: 1, docTitle: 'Second Document', fileName: 'b.pdf' },
      ]),
    ];
    render(
      <KnowledgeSources
        attachments={twoDocuments}
        answerText={`Fact one.${anchor(0)} Fact two.${anchor(1)}`}
      />,
    );
    expect(screen.getByText('First Document')).toBeInTheDocument();
    expect(screen.getByText('Second Document')).toBeInTheDocument();
  });

  test('shows only the first three documents, with the rest behind "Show N more"', () => {
    const attachments = [
      knowledgeAttachment(
        Array.from({ length: 5 }, (_, i) => ({
          fileId: `f${i}`,
          citationIndex: i,
          docTitle: `Document ${i}`,
          fileName: `f${i}.txt`,
        })),
      ),
    ];
    const answerText = Array.from({ length: 5 }, (_, i) => `Fact ${i}.${anchor(i)}`).join(' ');
    render(<KnowledgeSources attachments={attachments} answerText={answerText} />);

    for (let i = 0; i < 3; i++) {
      expect(screen.getByText(`Document ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText('Document 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Document 4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Show 2 more'));

    expect(screen.getByText('Document 3')).toBeInTheDocument();
    expect(screen.getByText('Document 4')).toBeInTheDocument();
    expect(screen.queryByText(/Show \d+ more/)).not.toBeInTheDocument();
  });
});

describe('KnowledgeSources: отбор по цитатам', () => {
  const threeDocuments = [
    knowledgeAttachment([
      { fileId: 'lec1', citationIndex: 0, docTitle: 'Лекция 1', fileName: 'lec1.pdf' },
      { fileId: 'lec2', citationIndex: 1, docTitle: 'Лекция 2', fileName: 'lec2.pdf' },
      { fileId: 'tickets', citationIndex: 2, docTitle: 'Билеты', fileName: 'tickets.pdf' },
    ]),
  ];

  test('показывает только документ, на который модель сослалась', () => {
    render(
      <KnowledgeSources
        attachments={threeDocuments}
        answerText={'Вылет из Шереметьево.\\ue202turn0file2'}
      />,
    );

    expect(screen.getByText('Билеты')).toBeInTheDocument();
    expect(screen.queryByText('Лекция 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Лекция 2')).not.toBeInTheDocument();
  });

  test('не показывает блок вовсе, когда модель не сослалась ни на один документ', () => {
    const { container } = render(
      <KnowledgeSources attachments={threeDocuments} answerText="Ответ без якорей." />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Лекция 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Лекция 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Билеты')).not.toBeInTheDocument();
  });

  test('понимает якорь, записанный самим символом U+E202', () => {
    render(
      <KnowledgeSources attachments={threeDocuments} answerText={'Факт.\u{E202}turn0file1'} />,
    );

    expect(screen.getByText('Лекция 2')).toBeInTheDocument();
    expect(screen.queryByText('Билеты')).not.toBeInTheDocument();
  });

  test('несколько якорей оставляют несколько документов', () => {
    render(
      <KnowledgeSources
        attachments={threeDocuments}
        answerText={'Раз.\\ue202turn0file0 Два.\\ue202turn0file2'}
      />,
    );

    expect(screen.getByText('Лекция 1')).toBeInTheDocument();
    expect(screen.getByText('Билеты')).toBeInTheDocument();
    expect(screen.queryByText('Лекция 2')).not.toBeInTheDocument();
  });

  test('якорь на несуществующий номер не показывает ни один документ', () => {
    const { container } = render(
      <KnowledgeSources attachments={threeDocuments} answerText={'Факт.\\ue202turn0file9'} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Лекция 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Билеты')).not.toBeInTheDocument();
  });

  test('источник без номера цитирования не подхватывается якорем и блок скрывается', () => {
    const attachments = [
      knowledgeAttachment([{ fileId: 'old1', docTitle: 'Старый документ', fileName: 'old.docx' }]),
    ];
    const { container } = render(
      <KnowledgeSources attachments={attachments} answerText={'Факт.\\ue202turn0file0'} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Старый документ')).not.toBeInTheDocument();
  });
});
