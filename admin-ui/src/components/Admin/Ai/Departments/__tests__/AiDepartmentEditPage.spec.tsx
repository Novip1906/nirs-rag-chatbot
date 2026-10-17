import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminDepartment } from '~/api';
import type { DirectoryDepartment } from '~/types/directory';
import AiDepartmentEditPage from '../AiDepartmentEditPage';

const mockAiQuery = jest.fn();
const mockDirectoryQuery = jest.fn();
const mockUpdate = jest.fn();
const mockNavigate = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminDepartmentsQuery: () => mockAiQuery(),
  useUpdateAdminDepartmentMutation: () => ({ mutate: mockUpdate, isLoading: false }),
}));

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryDepartmentsQuery: () => mockDirectoryQuery(),
}));

jest.mock('~/components/Admin/common/ModelAccess', () => ({
  __esModule: true,
  default: () => <div data-testid="model-access-fields" />,
}));

jest.mock('~/components/Admin/common/LimitsFields', () => ({
  __esModule: true,
  default: () => <div data-testid="limits-fields" />,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@librechat/client', () => {
  const { createEmployeesClientMock } = jest.requireActual('test/employeesClientMock');
  return createEmployeesClientMock();
});

const AI_DEPARTMENT: AdminDepartment = {
  id: 'mongo-1',
  name: 'Legal',
  description: 'Legal team',
  systemPrompt: 'Be precise.',
  allowedModels: ['gpt-4o'],
  defaultModel: 'gpt-4o',
  defaultLimits: { dailyCostUsd: null },
  directoryId: 'dir-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DIRECTORY_DEPARTMENT: DirectoryDepartment = {
  id: 'dir-1',
  name: 'Legal',
  description: 'Legal team',
  employees_count: 1,
  created_at: '',
  updated_at: '',
  deleted_at: null,
};

function renderPage({
  ai = [AI_DEPARTMENT],
  directory = [DIRECTORY_DEPARTMENT],
  aiRefetch = jest.fn(),
  path = '/admin/ai/departments/dir-1',
}: {
  ai?: AdminDepartment[];
  directory?: DirectoryDepartment[];
  aiRefetch?: jest.Mock;
  path?: string;
} = {}) {
  mockAiQuery.mockReturnValue({
    data: ai,
    isLoading: false,
    isError: false,
    refetch: aiRefetch,
  });
  mockDirectoryQuery.mockReturnValue({
    data: directory,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/ai/departments/:id" element={<AiDepartmentEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return { aiRefetch, rerender: view.rerender };
}

describe('AiDepartmentEditPage', () => {
  it('picks up fresh data while untouched and keeps edits afterwards', () => {
    const view = renderPage();
    const rerenderWith = (systemPrompt: string, updatedAt: string) => {
      mockAiQuery.mockReturnValue({
        data: [{ ...AI_DEPARTMENT, systemPrompt, updatedAt }],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      });
      view.rerender(
        <MemoryRouter initialEntries={['/admin/ai/departments/dir-1']}>
          <Routes>
            <Route path="/admin/ai/departments/:id" element={<AiDepartmentEditPage />} />
          </Routes>
        </MemoryRouter>,
      );
    };

    rerenderWith('Fresh prompt', '2026-10-02T10:00:00.000Z');
    expect(screen.getByDisplayValue('Fresh prompt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_prompt'), {
      target: { value: 'Mine' },
    });
    rerenderWith('Another prompt', '2026-10-03T10:00:00.000Z');
    expect(screen.getByDisplayValue('Mine')).toBeInTheDocument();
  });

  it('finds the department by directoryId and shows its name as the title', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Legal');
    expect(screen.getByDisplayValue('Be precise.')).toBeInTheDocument();
  });

  it('links to general settings', () => {
    renderPage();

    expect(screen.getByText('com_admin_ai_departments_general_link').closest('a')).toHaveAttribute(
      'href',
      '/admin/departments/dir-1',
    );
  });

  it('saves only AI fields and returns to the ai list', () => {
    mockUpdate.mockImplementation((_vars, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_prompt'), {
      target: { value: 'New prompt' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      id: 'mongo-1',
      payload: {
        systemPrompt: 'New prompt',
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        defaultLimits: { dailyCostUsd: null },
      },
    });
    expect(mockNavigate).toHaveBeenCalledWith('/admin/ai/departments');
  });

  it('shows the pending message with a refresh button when the pair is not reconciled yet', () => {
    const { aiRefetch } = renderPage({ ai: [] });

    expect(screen.getByText('com_admin_ai_departments_pending')).toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_departments_field_prompt')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Legal');

    fireEvent.click(screen.getByText('com_admin_ai_departments_refresh'));
    expect(aiRefetch).toHaveBeenCalled();
  });

  it('shows not found when neither side knows the department', () => {
    renderPage({ ai: [], directory: [], path: '/admin/ai/departments/missing' });

    expect(screen.getByText('com_admin_departments_not_found')).toBeInTheDocument();
    expect(screen.queryByText('com_admin_ai_departments_pending')).not.toBeInTheDocument();
  });
});
