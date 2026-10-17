import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { KnowledgeDocumentItem, KnowledgeSpaceItem } from '~/api';
import SpaceDocumentsPage from '../SpaceDocumentsPage';

const mockUseKnowledgeSpacesQuery = jest.fn();
const mockUseKnowledgeDocumentsQuery = jest.fn();
const mockUseCapabilities = jest.fn();
const mockReindexMutate = jest.fn();

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeSpacesQuery: () => mockUseKnowledgeSpacesQuery(),
  useKnowledgeDocumentsQuery: () => mockUseKnowledgeDocumentsQuery(),
  useUploadDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeleteDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useReindexSpaceMutation: () => ({ mutate: mockReindexMutate, isLoading: false }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ id: 'space-1' }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) => {
    if (values != null) {
      return `${key}:${JSON.stringify(values)}`;
    }
    return key;
  },
  useCapabilities: () => mockUseCapabilities(),
}));

beforeEach(() => {
  mockUseCapabilities.mockReturnValue({ capabilities: new Set(['manage:configs']) });
  mockReindexMutate.mockClear();
});

/**
 * Same rationale as `Knowledge/__tests__/SpacesView.spec.tsx` — the real
 * `@librechat/client` bundle can't resolve `@react-spring/web` from here.
 */
jest.mock('@librechat/client', () => {
  const ReactActual = jest.requireActual('react');
  return {
    Table: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('table', null, children),
    TableHeader: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('thead', null, children),
    TableBody: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('tbody', null, children),
    TableRow: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('tr', props, children),
    TableHead: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('th', null, children),
    TableRowHeader: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('th', null, children),
    TableCell: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('td', null, children),
    Tag: ({ label }: { label: string }) => ReactActual.createElement('span', null, label),
    Button: ({
      children,
      asChild,
      ...props
    }: React.PropsWithChildren<{ asChild?: boolean } & Record<string, unknown>>) =>
      asChild ? children : ReactActual.createElement('button', props, children),
    IconButton: ({
      children,
      label,
      onClick,
    }: React.PropsWithChildren<{
      label: string;
      onClick?: (event: React.MouseEvent) => void;
    }>) => ReactActual.createElement('button', { 'aria-label': label, onClick }, children),
    EmptyState: ({ title }: { title: string }) => ReactActual.createElement('div', null, title),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      ReactActual.createElement('input', props),
    Label: ({ children, htmlFor }: React.PropsWithChildren<{ htmlFor?: string }>) =>
      ReactActual.createElement('label', { htmlFor }, children),
    Select: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    SelectTrigger: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    SelectItem: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialog: ({ children, open }: React.PropsWithChildren<{ open: boolean }>) =>
      open ? ReactActual.createElement('div', null, children) : null,
    AlertDialogContent: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialogHeader: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialogTitle: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialogDescription: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialogFooter: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    AlertDialogCancel: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('button', null, children),
    AlertDialogAction: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) =>
      ReactActual.createElement('button', { onClick }, children),
  };
});

const SPACE: KnowledgeSpaceItem = {
  id: 'space-1',
  name: 'Корпоративные стандарты',
  description: '',
  allowedDepartments: [],
  embeddingModel: 'baai/bge-m3',
  enabled: true,
  documentCount: 2,
};

const ACTIVE_DOC: KnowledgeDocumentItem = {
  id: 'doc-active',
  spaceId: 'space-1',
  fileId: 'file-active',
  title: 'Положение об отпусках',
  filename: 'otpuska.pdf',
  source: '',
  owner: '',
  uploadedBy: 'user-1',
  uploadedByName: 'Иван Иванов',
  version: '2.1',
  effectiveDate: null,
  status: 'active',
  embeddingModel: 'baai/bge-m3',
  bytes: 100,
  mimetype: 'application/pdf',
  embedded: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const ARCHIVED_DOC: KnowledgeDocumentItem = {
  ...ACTIVE_DOC,
  id: 'doc-archived',
  fileId: 'file-archived',
  title: 'Положение об отпусках (ред. 1.0)',
  version: '1.0',
  status: 'archived',
};

function renderPage() {
  mockUseKnowledgeSpacesQuery.mockReturnValue({
    data: [SPACE],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUseKnowledgeDocumentsQuery.mockReturnValue({
    data: [ACTIVE_DOC, ARCHIVED_DOC],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <SpaceDocumentsPage />
    </MemoryRouter>,
  );
}

describe('SpaceDocumentsPage — active vs. archived documents', () => {
  it('marks an archived document with its status tag and keeps it out of the active table', () => {
    renderPage();

    const archivedSection = screen
      .getByText('com_admin_knowledge_documents_archived_section')
      .closest('div') as HTMLElement;
    expect(
      within(archivedSection).getByText('Положение об отпусках (ред. 1.0)'),
    ).toBeInTheDocument();
    expect(
      within(archivedSection).getByText('com_admin_knowledge_status_archived'),
    ).toBeInTheDocument();
    expect(within(archivedSection).queryByText('Положение об отпусках')).not.toBeInTheDocument();
  });

  it('keeps the active document in a separate table from the archived one', () => {
    renderPage();

    const rows = screen.getAllByText(/Положение об отпусках/);
    expect(rows).toHaveLength(2);

    const activeTitleCell = screen.getByText('Положение об отпусках');
    const archivedTitleCell = screen.getByText('Положение об отпусках (ред. 1.0)');
    expect(activeTitleCell.closest('table')).not.toBe(archivedTitleCell.closest('table'));
  });
});

describe('SpaceDocumentsPage — лента последних загрузок', () => {
  it('sorts documents newest upload first', () => {
    const older: KnowledgeDocumentItem = {
      ...ACTIVE_DOC,
      id: 'doc-older',
      title: 'Older doc',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newer: KnowledgeDocumentItem = {
      ...ACTIVE_DOC,
      id: 'doc-newer',
      title: 'Newer doc',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [SPACE],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseKnowledgeDocumentsQuery.mockReturnValue({
      data: [older, newer],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <SpaceDocumentsPage />
      </MemoryRouter>,
    );

    const rows = screen.getAllByRole('row').filter((row) => row.closest('tbody') != null);
    const rowText = rows.map((row) => row.textContent ?? '');
    expect(rowText.findIndex((text) => text.includes('Newer doc'))).toBeLessThan(
      rowText.findIndex((text) => text.includes('Older doc')),
    );
  });

  it('shows who uploaded the document by name, not by raw id', () => {
    renderPage();

    expect(screen.getAllByText('Иван Иванов').length).toBeGreaterThan(0);
    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
  });

  it('falls back to a placeholder when the server could not resolve an uploader name', () => {
    const withoutName: KnowledgeDocumentItem = { ...ACTIVE_DOC, uploadedByName: undefined };
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [SPACE],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseKnowledgeDocumentsQuery.mockReturnValue({
      data: [withoutName],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <SpaceDocumentsPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('com_insights_unknown_user').length).toBeGreaterThan(0);
  });

  /** Битая дата не должна давать `NaN` в сравнении — тогда строка встаёт в произвольное
   *  место относительно соседей. Она считается самой старой и уходит в конец. */
  it('sorts a document with an unparseable date to the end instead of a random spot', () => {
    const broken: KnowledgeDocumentItem = {
      ...ACTIVE_DOC,
      id: 'doc-broken',
      title: 'Broken date doc',
      createdAt: 'not-a-date',
    };
    const newer: KnowledgeDocumentItem = {
      ...ACTIVE_DOC,
      id: 'doc-newer',
      title: 'Newer doc',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [SPACE],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseKnowledgeDocumentsQuery.mockReturnValue({
      data: [broken, newer],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <SpaceDocumentsPage />
      </MemoryRouter>,
    );

    const rows = screen.getAllByRole('row').filter((row) => row.closest('tbody') != null);
    const rowText = rows.map((row) => row.textContent ?? '');
    expect(rowText.findIndex((text) => text.includes('Newer doc'))).toBeLessThan(
      rowText.findIndex((text) => text.includes('Broken date doc')),
    );
  });
});

/**
 * `embedded: false` — сбой на стороне `rag_api`, который тот только логирует и
 * отвечает 200: документ выглядит как обычный, а поиск по нему в чате пуст.
 * Раньше это было видно только по логам пода; администратор должен увидеть
 * это прямо в списке и понять, что делать (кнопка «Переиндексировать»).
 */
describe('SpaceDocumentsPage — документ не проиндексирован', () => {
  it('показывает пометку у документа с embedded: false', () => {
    const notEmbedded: KnowledgeDocumentItem = {
      ...ACTIVE_DOC,
      id: 'doc-not-embedded',
      title: 'Регламент без индекса',
      embedded: false,
    };
    mockUseKnowledgeSpacesQuery.mockReturnValue({
      data: [SPACE],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseKnowledgeDocumentsQuery.mockReturnValue({
      data: [notEmbedded],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <SpaceDocumentsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('com_admin_knowledge_document_not_indexed')).toBeInTheDocument();
  });

  it('не показывает пометку у обычного проиндексированного документа', () => {
    renderPage();

    expect(
      screen.queryByText('com_admin_knowledge_document_not_indexed'),
    ).not.toBeInTheDocument();
  });
});

/** Переиндексация требует `manage:configs` — сервер отвечает 403 главе отдела. */
describe('SpaceDocumentsPage — глава отдела без manage:configs', () => {
  beforeEach(() => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(['manage:knowledge_documents']) });
  });

  it('прячет кнопку переиндексации', () => {
    renderPage();

    expect(screen.queryByText('com_admin_knowledge_reindex')).not.toBeInTheDocument();
  });
});

/**
 * Раньше при частичном сбое переиндексации админ не видел вообще ничего — ни
 * ошибки, ни успеха. Тост показывает счётчики, но исчезает сам; список пропущенных
 * документов с причинами должен оставаться видимым на странице.
 */
describe('SpaceDocumentsPage — переиндексация: пропущенные документы', () => {
  function clickReindexAndResolve(data: { reindexed: number; skipped: Array<{ title: string; reason: string }> }) {
    fireEvent.click(screen.getByText('com_admin_knowledge_reindex'));
    expect(mockReindexMutate).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const options = mockReindexMutate.mock.calls[0][1] as { onSuccess: (data: unknown) => void };
    act(() => {
      options.onSuccess(data);
    });
  }

  it('показывает список пропущенных документов после частично успешной переиндексации', () => {
    renderPage();

    clickReindexAndResolve({
      reindexed: 1,
      skipped: [{ title: 'Регламент', reason: 'Оригинал документа не сохранён' }],
    });

    expect(
      screen.getByText('com_admin_knowledge_reindex_skipped_title:{"count":1}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'com_admin_knowledge_reindex_skipped_reason:{"title":"Регламент","reason":"Оригинал документа не сохранён"}',
      ),
    ).toBeInTheDocument();
  });

  it('не показывает баннер, когда переиндексация ничего не пропустила', () => {
    renderPage();

    clickReindexAndResolve({ reindexed: 2, skipped: [] });

    expect(
      screen.queryByText(/com_admin_knowledge_reindex_skipped_title/),
    ).not.toBeInTheDocument();
  });
});
