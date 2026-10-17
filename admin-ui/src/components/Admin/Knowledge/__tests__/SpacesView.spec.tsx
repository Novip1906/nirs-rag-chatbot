import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminDepartment } from '~/api';
import type { KnowledgeSpaceItem } from '~/api';
import SpacesView from '../SpacesView';

const mockUseKnowledgeSpacesQuery = jest.fn();
const mockUseAdminDepartmentsQuery = jest.fn();
const mockNavigate = jest.fn();
const mockUseCapabilities = jest.fn();

jest.mock('~/data-provider/Knowledge', () => ({
  useKnowledgeSpacesQuery: () => mockUseKnowledgeSpacesQuery(),
  useDeleteSpaceMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/data-provider/Admin', () => ({
  useAdminDepartmentsQuery: () => mockUseAdminDepartmentsQuery(),
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

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

/**
 * Same rationale as `Departments/__tests__/DepartmentsView.spec.tsx`: the real
 * `@librechat/client` bundle can't resolve `@react-spring/web` from here, so the table
 * and dialog primitives are stubbed down to plain elements that forward the props this
 * test actually exercises (row click, stopPropagation on the action buttons).
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
    TableRow: ({
      children,
      onClick,
      className,
    }: React.PropsWithChildren<{ onClick?: () => void; className?: string }>) =>
      ReactActual.createElement('tr', { onClick, className }, children),
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

const DEPARTMENT: AdminDepartment = {
  id: 'dept-1',
  name: 'Юридический',
  description: '',
  systemPrompt: '',
  allowedModels: [],
  defaultModel: null,
  defaultLimits: { dailyCostUsd: null },
  directoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SPACE_ALL_DEPARTMENTS: KnowledgeSpaceItem = {
  id: 'space-1',
  name: 'Корпоративные стандарты',
  description: 'Общие правила компании',
  allowedDepartments: [],
  embeddingModel: 'baai/bge-m3',
  enabled: true,
  documentCount: 3,
};

const SPACE_RESTRICTED: KnowledgeSpaceItem = {
  id: 'space-2',
  name: 'Юридическое',
  description: '',
  allowedDepartments: ['dept-1'],
  embeddingModel: 'baai/bge-m3',
  enabled: false,
  documentCount: 0,
};

function renderSpacesView(spaces: KnowledgeSpaceItem[], departments: AdminDepartment[] = [DEPARTMENT]) {
  mockUseKnowledgeSpacesQuery.mockReturnValue({
    data: spaces,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUseAdminDepartmentsQuery.mockReturnValue({
    data: departments,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <SpacesView />
    </MemoryRouter>,
  );
}

describe('SpacesView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['manage:knowledge_documents']),
      role: 'ADMIN',
      departmentId: null,
    });
  });

  it('renders the space name as a real link pointing at the documents page', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    const link = screen.getByRole('link', { name: SPACE_ALL_DEPARTMENTS.name });
    expect(link).toHaveAttribute('href', '/admin/knowledge/space-1');
  });

  it('navigates to the documents page when clicking anywhere else in the row', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    fireEvent.click(screen.getByText(SPACE_ALL_DEPARTMENTS.description));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/knowledge/space-1');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('navigates exactly once when clicking the edit pencil button, not twice via bubbling', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    fireEvent.click(screen.getByLabelText('com_admin_knowledge_edit'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/knowledge/space-1/edit');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when clicking delete — it only opens the confirm dialog', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    fireEvent.click(screen.getByLabelText('com_admin_knowledge_delete'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('com_admin_knowledge_delete_title')).toBeInTheDocument();
  });

  it('a space with no allowed departments is shown as available to everyone', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    expect(screen.getByText('com_admin_knowledge_departments_all')).toBeInTheDocument();
  });

  it('a space restricted to a department shows that department by name, not its id', () => {
    renderSpacesView([SPACE_RESTRICTED]);

    expect(screen.getByText('Юридический')).toBeInTheDocument();
    expect(screen.queryByText('dept-1')).not.toBeInTheDocument();
  });
});

/**
 * Создание, правка и удаление пространства теперь идут за `manage:knowledge_documents` —
 * тем же полномочием, что и у документов. Глава отдела его держит, но ограничена своим
 * отделом: сервер (`departmentScope`/`resolveHeadSpaceDepartments`) пропускает её только
 * на пространства, где её отдел явно в `allowedDepartments`, — `headCanManageSpace`
 * повторяет ту же границу на клиенте, чтобы не показывать кнопку там, где сервер
 * откажет.
 */
describe('SpacesView — глава отдела', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(['manage:knowledge_documents']),
      role: 'HEAD',
      departmentId: 'dept-1',
      departmentName: 'Юридический',
    });
  });

  it('показывает создание, правку и удаление для пространства своего отдела', () => {
    renderSpacesView([SPACE_RESTRICTED]);

    expect(screen.getByText('com_admin_knowledge_create')).toBeInTheDocument();
    expect(screen.getByLabelText('com_admin_knowledge_edit')).toBeInTheDocument();
    expect(screen.getByLabelText('com_admin_knowledge_delete')).toBeInTheDocument();
  });

  /**
   * `GET /admin/departments` требует админ-уровня и главе всегда отвечает 403 — в
   * реальности `departments` для неё пуст. Название своего отдела в колонке «Отделы»
   * должно взяться из `useCapabilities().departmentName`, а не превратиться в сырой id.
   */
  it('показывает название своего отдела в таблице, даже когда справочник отделов главе недоступен', () => {
    renderSpacesView([SPACE_RESTRICTED], []);

    expect(screen.getByText('Юридический')).toBeInTheDocument();
    expect(screen.queryByText('dept-1')).not.toBeInTheDocument();
  });

  it('прячет правку и удаление общедоступного пространства — оно не в её отделе', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    expect(screen.queryByLabelText('com_admin_knowledge_edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_knowledge_delete')).not.toBeInTheDocument();
  });

  it('оставляет строку кликабельной для перехода к документам даже без прав на правку', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    fireEvent.click(screen.getByText(SPACE_ALL_DEPARTMENTS.description));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/knowledge/space-1');
  });
});

describe('SpacesView — без manage:knowledge_documents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCapabilities.mockReturnValue({
      capabilities: new Set(),
      role: 'USER',
      departmentId: null,
    });
  });

  it('прячет создание, правку и удаление пространства', () => {
    renderSpacesView([SPACE_ALL_DEPARTMENTS]);

    expect(screen.queryByText('com_admin_knowledge_create')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_knowledge_edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_knowledge_delete')).not.toBeInTheDocument();
  });
});
