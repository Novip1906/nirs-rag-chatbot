import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import KnowledgeView from '../KnowledgeView';
import {
  useDeleteEmployeeKnowledgeDocumentMutation,
  useEmployeeDocumentsQuery,
  useEmployeeSpacesQuery,
} from '~/data-provider/Knowledge';
import type { KnowledgeDocumentItem, KnowledgeSpaceSummary } from 'librechat-data-provider';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values != null ? `${key}:${JSON.stringify(values)}` : key,
  useAuthContext: () => ({ user: { id: 'user-1', role: 'user' } }),
}));

jest.mock('@librechat/client', () => {
  const ActualReact = jest.requireActual('react');
  return {
    useMediaQuery: () => false,
    Spinner: () => ActualReact.createElement('div', { 'data-testid': 'spinner' }),
    Button: ({ children, ...rest }: React.ComponentProps<'button'>) =>
      ActualReact.createElement('button', rest, children),
    Input: (props: React.ComponentProps<'input'>) => ActualReact.createElement('input', props),
    Label: ({ children, ...rest }: React.ComponentProps<'label'>) =>
      ActualReact.createElement('label', rest, children),
    Textarea: (props: React.ComponentProps<'textarea'>) =>
      ActualReact.createElement('textarea', props),
    Switch: ({
      checked,
      onCheckedChange,
      ...rest
    }: {
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
    } & React.ComponentProps<'button'>) =>
      ActualReact.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        onClick: () => onCheckedChange(!checked),
        ...rest,
      }),
    TooltipAnchor: ({ render: rendered }: { render: React.ReactNode }) => rendered,
    OGDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? ActualReact.createElement('div', { role: 'dialog' }, children) : null,
    OGDialogTemplate: ({
      title,
      main,
      buttons,
      selection,
    }: {
      title: React.ReactNode;
      main: React.ReactNode;
      buttons?: React.ReactNode;
      selection?: { selectHandler: () => void; selectText: React.ReactNode };
    }) =>
      ActualReact.createElement(
        'div',
        null,
        title,
        main,
        buttons,
        selection != null
          ? ActualReact.createElement(
              'button',
              { type: 'button', onClick: selection.selectHandler },
              selection.selectText,
            )
          : null,
      ),
    useToastContext: () => ({ showToast: jest.fn() }),
  };
});

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="open-sidebar" />,
}));

jest.mock('~/components/Chat/Messages/Content/KnowledgeDocumentDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/data-provider/Knowledge', () => ({
  useEmployeeSpacesQuery: jest.fn(),
  useEmployeeDocumentsQuery: jest.fn(),
  useUpdateEmployeeKnowledgeDocumentMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
  useArchiveEmployeeKnowledgeDocumentMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
  useDeleteEmployeeKnowledgeDocumentMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
  useUploadEmployeeKnowledgeDocumentMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
}));

const mockUseEmployeeSpacesQuery = useEmployeeSpacesQuery as jest.Mock;
const mockUseEmployeeDocumentsQuery = useEmployeeDocumentsQuery as jest.Mock;

function mockSpaces(spaces: Array<Partial<KnowledgeSpaceSummary> & { id: string; name: string }>) {
  const full: KnowledgeSpaceSummary[] = spaces.map((space) => ({
    allowedDepartments: [],
    enabled: true,
    canWrite: false,
    canManage: false,
    ...space,
  }));
  mockUseEmployeeSpacesQuery.mockReturnValue({
    data: full,
    isLoading: false,
    isError: false,
  });
}

function mockDocuments(
  documents: Array<Partial<KnowledgeDocumentItem> & { id: string; title: string; fileId: string }>,
) {
  const full: KnowledgeDocumentItem[] = documents.map((doc) => ({
    spaceId: 's1',
    description: '',
    filename: '',
    source: '',
    owner: '',
    uploadedBy: 'someone-else',
    version: '',
    effectiveDate: null,
    status: 'active',
    embeddingModel: '',
    bytes: 0,
    mimetype: '',
    embedded: false,
    createdAt: new Date(0).toISOString(),
    ...doc,
  }));
  mockUseEmployeeDocumentsQuery.mockReturnValue({
    data: full,
    isLoading: false,
    isError: false,
  });
}

function renderKnowledgeView(path = '/knowledge') {
  const router = createMemoryRouter(
    [
      { path: '/knowledge', element: <KnowledgeView /> },
      { path: '/knowledge/:spaceId', element: <KnowledgeView /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('KnowledgeView', () => {
  beforeEach(() => {
    mockUseEmployeeSpacesQuery.mockReset();
    mockUseEmployeeDocumentsQuery.mockReset();
    mockUseEmployeeDocumentsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('показывает документы пространства из адреса', async () => {
    mockSpaces([
      { id: 's1', name: 'Продажи', canWrite: false },
      { id: 's2', name: 'Логистика', canWrite: false },
    ]);
    mockDocuments([
      {
        id: 'd1',
        title: 'Регламент эквайринга',
        description: '',
        effectiveDate: '2026-03-01',
        fileId: 'f1',
      },
    ]);

    renderKnowledgeView('/knowledge/s2');

    expect(await screen.findByText('Логистика')).toBeInTheDocument();
    expect(await screen.findByText('Регламент эквайринга')).toBeInTheDocument();
  });

  /** Пространства живут в сайдбаре, поэтому сама страница их не рисует. */
  it('не показывает список пространств на самой странице', async () => {
    mockSpaces([
      { id: 's1', name: 'Продажи', canWrite: false },
      { id: 's2', name: 'Логистика', canWrite: false },
    ]);
    renderKnowledgeView('/knowledge/s1');

    await screen.findByText('Продажи');
    expect(screen.queryByRole('button', { name: 'Логистика' })).not.toBeInTheDocument();
  });

  /** Ссылка на удалённое пространство и голый `/knowledge` ведут в первое. */
  it('открывает первое пространство, когда в адресе нет годного', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: false }]);
    renderKnowledgeView('/knowledge/s-удалённое');

    expect(await screen.findByText('Продажи')).toBeInTheDocument();
  });

  it('показывает объяснение, если доступных пространств нет вовсе', async () => {
    mockSpaces([]);
    renderKnowledgeView();

    expect(await screen.findByText('com_knowledge_no_spaces_title')).toBeInTheDocument();
    expect(screen.getByText('com_knowledge_no_spaces_description')).toBeInTheDocument();
  });

  it('показывает кнопки правки и архивирования только для своих документов', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: true }]);
    mockDocuments([
      { id: 'd1', title: 'Мой документ', fileId: 'f1', uploadedBy: 'user-1' },
      { id: 'd2', title: 'Чужой документ', fileId: 'f2', uploadedBy: 'someone-else' },
    ]);

    renderKnowledgeView();

    await screen.findByText('Мой документ');
    expect(screen.getByRole('button', { name: /com_ui_edit Мой документ/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /com_ui_edit Чужой документ/i }),
    ).not.toBeInTheDocument();
  });

  it('фильтрует документы по названию без учёта регистра', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: false }]);
    mockDocuments([
      { id: 'd1', title: 'Регламент эквайринга', fileId: 'f1' },
      { id: 'd2', title: 'Договор аренды', fileId: 'f2' },
    ]);

    renderKnowledgeView();
    await screen.findByText('Регламент эквайринга');

    await userEvent.type(
      screen.getByPlaceholderText('com_knowledge_search_placeholder'),
      'ЭКВАЙРИНГА',
    );

    expect(screen.getByText('Регламент эквайринга')).toBeInTheDocument();
    expect(screen.queryByText('Договор аренды')).not.toBeInTheDocument();
  });

  it('находит документ по описанию', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: false }]);
    mockDocuments([
      { id: 'd1', title: 'Документ A', description: 'важные реквизиты компании', fileId: 'f1' },
      { id: 'd2', title: 'Документ B', description: '', fileId: 'f2' },
    ]);

    renderKnowledgeView();
    await screen.findByText('Документ A');

    await userEvent.type(
      screen.getByPlaceholderText('com_knowledge_search_placeholder'),
      'реквизиты',
    );

    expect(screen.getByText('Документ A')).toBeInTheDocument();
    expect(screen.queryByText('Документ B')).not.toBeInTheDocument();
  });

  it('показывает пустое состояние, когда поиск ничего не находит', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: false }]);
    mockDocuments([{ id: 'd1', title: 'Регламент эквайринга', fileId: 'f1' }]);

    renderKnowledgeView();
    await screen.findByText('Регламент эквайринга');

    await userEvent.type(
      screen.getByPlaceholderText('com_knowledge_search_placeholder'),
      'несуществующий запрос',
    );

    expect(screen.queryByText('Регламент эквайринга')).not.toBeInTheDocument();
    expect(screen.getByText('com_knowledge_no_search_results_title')).toBeInTheDocument();
  });

  it('переключатель «показать архивные» и кнопка удаления видны только тому, кто управляет пространством', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: true, canManage: true }]);
    mockDocuments([
      {
        id: 'd1',
        title: 'Активный документ',
        fileId: 'f1',
        status: 'active',
        uploadedBy: 'someone-else',
      },
      {
        id: 'd2',
        title: 'Архивный документ',
        fileId: 'f2',
        status: 'archived',
        uploadedBy: 'someone-else',
      },
    ]);

    renderKnowledgeView();
    await screen.findByText('Активный документ');

    expect(screen.queryByText('Архивный документ')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /com_ui_delete Активный документ/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'com_knowledge_show_archived' }));

    expect(await screen.findByText('Архивный документ')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /com_ui_delete Архивный документ/i }),
    ).toBeInTheDocument();
  });

  it('не показывает переключатель архивных и кнопку удаления рядовому сотруднику без права управления пространством', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: true, canManage: false }]);
    mockDocuments([{ id: 'd1', title: 'Мой документ', fileId: 'f1', uploadedBy: 'user-1' }]);

    renderKnowledgeView();
    await screen.findByText('Мой документ');

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /com_ui_delete Мой документ/i }),
    ).not.toBeInTheDocument();
  });

  it('подтверждение удаления вызывает безвозвратное удаление документа', async () => {
    const mutate = jest.fn();
    (useDeleteEmployeeKnowledgeDocumentMutation as jest.Mock).mockReturnValue({
      mutate,
      isLoading: false,
    });
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: true, canManage: true }]);
    mockDocuments([{ id: 'd1', title: 'Регламент', fileId: 'f1', uploadedBy: 'someone-else' }]);

    renderKnowledgeView();
    await screen.findByText('Регламент');

    await userEvent.click(screen.getByRole('button', { name: /com_ui_delete Регламент/i }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));

    expect(mutate).toHaveBeenCalledWith('d1');
  });
});
