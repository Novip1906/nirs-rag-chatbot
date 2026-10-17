import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import type { KnowledgeSpaceSummary } from 'librechat-data-provider';
import { useEmployeeSpacesQuery } from '~/data-provider/Knowledge';
import SpacesSection from '../SpacesSection';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  /** По умолчанию — рядовой сотрудник: кнопка создания раздела видна только
   *  HEAD/админу (§ `SpacesSection.canCreateSpace`), тесты ниже её не касаются. */
  useAuthContext: () => ({ user: { role: 'USER' } }),
}));

const mockSetSidebarOpen = jest.fn();

jest.mock('~/hooks/Nav/useSidebarToggle', () => ({
  __esModule: true,
  default: () => ({ setSidebarOpen: mockSetSidebarOpen }),
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
    OGDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? ActualReact.createElement('div', { role: 'dialog' }, children) : null,
    OGDialogTemplate: ({ title, main }: { title: React.ReactNode; main: React.ReactNode }) =>
      ActualReact.createElement('div', null, title, main),
    useToastContext: () => ({ showToast: jest.fn() }),
    /** `SpaceList` (rendered by `SpacesSection`) composes its row-action button
     *  from these — none of the tests below put a manageable space on screen,
     *  so a minimal stub is enough to keep the module from throwing on import. */
    buttonVariants: () => '',
    DropdownPopup: () => null,
  };
});

jest.mock('~/data-provider/Knowledge', () => ({
  useEmployeeSpacesQuery: jest.fn(),
  useEmployeeDocumentsQuery: jest.fn(() => ({ data: [], isLoading: false, isError: false })),
  useUploadEmployeeKnowledgeDocumentMutation: jest.fn(() => ({
    mutate: jest.fn(),
    isLoading: false,
  })),
  /** `SpaceEditDialog`/`SpaceDeleteDialog` mount inside every row regardless of
   *  `canManage` (only their own `open` prop gates the dialog UI), so their
   *  mutation hooks run even for rows none of these tests make manageable. */
  useCreateEmployeeSpaceMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
  useUpdateEmployeeSpaceMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
  useDeleteEmployeeSpaceMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
}));

const mockUseEmployeeSpacesQuery = useEmployeeSpacesQuery as jest.Mock;

function mockSpaces(spaces: Array<Partial<KnowledgeSpaceSummary> & { id: string; name: string }>) {
  const full: KnowledgeSpaceSummary[] = spaces.map((space) => ({
    allowedDepartments: [],
    enabled: true,
    canWrite: false,
    canManage: false,
    ...space,
  }));
  mockUseEmployeeSpacesQuery.mockReturnValue({ data: full, isLoading: false, isError: false });
}

function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderSection(path = '/knowledge') {
  const element = (
    <>
      <SpacesSection />
      <CurrentPath />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: '/knowledge', element },
      { path: '/knowledge/:spaceId', element },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('SpacesSection', () => {
  beforeEach(() => {
    mockUseEmployeeSpacesQuery.mockReset();
    mockSetSidebarOpen.mockClear();
  });

  it('перечисляет доступные пространства', async () => {
    mockSpaces([
      { id: 's1', name: 'Продажи' },
      { id: 's2', name: 'Логистика' },
    ]);
    renderSection();

    expect(await screen.findByRole('button', { name: 'Продажи' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Логистика' })).toBeInTheDocument();
  });

  /** Адрес — единственное место, где хранится выбор, иначе панель и документы
   *  рядом с ней могли бы разойтись в том, что открыто. */
  it('переносит выбор пространства в адрес', async () => {
    mockSpaces([
      { id: 's1', name: 'Продажи' },
      { id: 's2', name: 'Логистика' },
    ]);
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Логистика' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/knowledge/s2');
  });

  it('отмечает пространство из адреса как выбранное', async () => {
    mockSpaces([
      { id: 's1', name: 'Продажи' },
      { id: 's2', name: 'Логистика' },
    ]);
    renderSection('/knowledge/s2');

    expect(await screen.findByRole('button', { name: 'Логистика' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('не показывает кнопку загрузки, если нет ни одного пространства на запись', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: false }]);
    renderSection();

    await screen.findByRole('button', { name: 'Продажи' });
    expect(screen.queryByRole('button', { name: /com_ui_upload/i })).not.toBeInTheDocument();
  });

  it('показывает кнопку загрузки, если есть хотя бы одно', async () => {
    mockSpaces([{ id: 's1', name: 'Продажи', canWrite: true }]);
    renderSection();

    expect(await screen.findByRole('button', { name: /com_ui_upload/i })).toBeInTheDocument();
  });
});
