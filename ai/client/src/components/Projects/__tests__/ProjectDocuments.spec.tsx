import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import ProjectDocuments from '../ProjectDocuments';
import type { TProjectDocument } from 'librechat-data-provider';

const mockUseProjectDocumentsQuery = jest.fn();
const mockUseUploadProjectDocumentMutation = jest.fn();
const mockUseDeleteProjectDocumentMutation = jest.fn();
const mockUseReindexProjectDocumentMutation = jest.fn();

jest.mock('~/data-provider/Projects/documents', () => ({
  useProjectDocumentsQuery: (...args: unknown[]) => mockUseProjectDocumentsQuery(...args),
  useUploadProjectDocumentMutation: (...args: unknown[]) =>
    mockUseUploadProjectDocumentMutation(...args),
  useDeleteProjectDocumentMutation: (...args: unknown[]) =>
    mockUseDeleteProjectDocumentMutation(...args),
  useReindexProjectDocumentMutation: (...args: unknown[]) =>
    mockUseReindexProjectDocumentMutation(...args),
}));

function makeDocument(overrides: Partial<TProjectDocument> = {}): TProjectDocument {
  return {
    fileId: 'doc-1',
    title: 'Регламент.docx',
    filename: 'Регламент.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: 1024 * 1024,
    tokenCount: 100,
    embedded: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProjectDocuments', () => {
  let mockDeleteMutate: jest.Mock;
  let mockUploadMutateAsync: jest.Mock;
  let mockReindexMutate: jest.Mock;

  beforeEach(() => {
    mockDeleteMutate = jest.fn();
    mockReindexMutate = jest.fn();
    mockUseReindexProjectDocumentMutation.mockReturnValue({
      mutate: mockReindexMutate,
      isLoading: false,
    });
    mockUploadMutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseDeleteProjectDocumentMutation.mockReturnValue({
      mutate: mockDeleteMutate,
      isLoading: false,
    });
    mockUseUploadProjectDocumentMutation.mockReturnValue({
      mutateAsync: mockUploadMutateAsync,
      isLoading: false,
    });
  });

  it('показывает подсказку, когда документов нет', () => {
    mockUseProjectDocumentsQuery.mockReturnValue({ data: { documents: [] }, isLoading: false });

    render(<ProjectDocuments projectId="p1" />);

    expect(screen.getByText('Project documents work in all its chats')).toBeInTheDocument();
  });

  it('перечисляет документы с размером и режимом', () => {
    mockUseProjectDocumentsQuery.mockReturnValue({
      data: {
        documents: [makeDocument({ title: 'Тарифы.pdf', bytes: 2 * 1024 * 1024, tokenCount: 100 })],
      },
      isLoading: false,
    });

    render(<ProjectDocuments projectId="p1" />);

    expect(screen.getByText('Тарифы.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    expect(screen.getByText('Read in full')).toBeInTheDocument();
  });

  /**
   * Режим — не поле в базе, а следствие бюджета: он пересчитывается на каждый
   * запрос. Клиент считает его той же функцией, что и сервер.
   */
  it('помечает мелкие документы как читаемые целиком, а крупные как ищущиеся', () => {
    mockUseProjectDocumentsQuery.mockReturnValue({
      data: {
        documents: [
          makeDocument({ fileId: 'small', title: 'small.docx', tokenCount: 500 }),
          makeDocument({ fileId: 'huge', title: 'huge.docx', tokenCount: 50000 }),
        ],
      },
      isLoading: false,
    });

    render(<ProjectDocuments projectId="p1" />);

    const smallRow = screen.getByText('small.docx').closest('li');
    const hugeRow = screen.getByText('huge.docx').closest('li');
    expect(smallRow).not.toBeNull();
    expect(hugeRow).not.toBeNull();
    expect(within(smallRow as HTMLElement).getByText('Read in full')).toBeInTheDocument();
    expect(within(hugeRow as HTMLElement).getByText('Searched by parts')).toBeInTheDocument();
  });

  it('вызывает удаление по кнопке', async () => {
    mockUseProjectDocumentsQuery.mockReturnValue({
      data: { documents: [makeDocument({ fileId: 'doc-1', title: 'Регламент.docx' })] },
      isLoading: false,
    });

    render(<ProjectDocuments projectId="p1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete document' }));

    expect(mockDeleteMutate).toHaveBeenCalledWith({ projectId: 'p1', fileId: 'doc-1' });
  });

  it('показывает содержательный текст сервера, когда загрузка не удалась', async () => {
    mockUseProjectDocumentsQuery.mockReturnValue({ data: { documents: [] }, isLoading: false });
    mockUploadMutateAsync.mockRejectedValue({
      response: { data: { error: 'Не удалось прочитать текст документа: похоже, это скан.' } },
    });

    render(<ProjectDocuments projectId="p1" />);

    const file = new File(['content'], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = screen.getByLabelText('Add document');
    await userEvent.upload(input, file);

    expect(
      screen.getByText('test.docx: Не удалось прочитать текст документа: похоже, это скан.'),
    ).toBeInTheDocument();
  });

  it('отсеивает неподдерживаемое расширение на клиенте, не отправляя запрос', async () => {
    mockUseProjectDocumentsQuery.mockReturnValue({ data: { documents: [] }, isLoading: false });

    render(<ProjectDocuments projectId="p1" />);

    // `accept` на input сам отфильтровал бы легаси-расширение в реальном браузере —
    // здесь эта фильтрация намеренно отключена, чтобы проверить, что сотрудник, выбравший
    // файл через "Все файлы", всё равно получает клиентскую проверку, а не запрос к серверу.
    const user = userEvent.setup({ applyAccept: false });
    const file = new File(['content'], 'legacy.doc', { type: 'application/msword' });
    const input = screen.getByLabelText('Add document');
    await user.upload(input, file);

    expect(mockUploadMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/legacy\.doc:/)).toBeInTheDocument();
  });

  it('загружает несколько выбранных файлов последовательно, по одному запросу на файл', async () => {
    mockUseProjectDocumentsQuery.mockReturnValue({ data: { documents: [] }, isLoading: false });

    render(<ProjectDocuments projectId="p1" />);

    const files = [
      new File(['a'], 'a.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ];
    const input = screen.getByLabelText('Add document');
    await userEvent.upload(input, files);

    expect(mockUploadMutateAsync).toHaveBeenCalledTimes(2);
    expect(mockUploadMutateAsync).toHaveBeenNthCalledWith(1, {
      projectId: 'p1',
      formData: expect.any(FormData),
    });
    expect(mockUploadMutateAsync).toHaveBeenNthCalledWith(2, {
      projectId: 'p1',
      formData: expect.any(FormData),
    });
  });

  it('помечает непроиндексированный документ и даёт повторить индексацию', async () => {
    mockUseProjectDocumentsQuery.mockReturnValue({
      data: { documents: [makeDocument({ title: 'Договор.docx', embedded: false })] },
      isLoading: false,
    });

    render(<ProjectDocuments projectId="p1" />);

    expect(screen.getByText('Not indexed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Index again' }));

    expect(mockReindexMutate).toHaveBeenCalledWith({ projectId: 'p1', fileId: 'doc-1' });
  });

  it('не показывает плашку у проиндексированного документа', () => {
    mockUseProjectDocumentsQuery.mockReturnValue({
      data: { documents: [makeDocument()] },
      isLoading: false,
    });

    render(<ProjectDocuments projectId="p1" />);

    expect(screen.queryByText('Not indexed')).not.toBeInTheDocument();
  });
});
