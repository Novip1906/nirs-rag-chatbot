import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminDepartment } from '~/api';
import AiDepartmentsView from '../AiDepartmentsView';

const mockAiQuery = jest.fn();
const mockNavigate = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminDepartmentsQuery: () => mockAiQuery(),
}));

jest.mock('~/components/Admin/utils/modelLabels', () => ({
  useModelLabel: () => (id: string) => `label:${id}`,
  useModelLabelList: () => (ids: string[]) => ids.join(', '),
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

const DEPARTMENT: AdminDepartment = {
  id: 'mongo-1',
  name: 'Legal',
  systemPrompt: '',
  allowedModels: [],
  defaultModel: 'gpt-4o',
  defaultLimits: { dailyCostUsd: 12.5 },
  directoryId: 'dir-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderView(items: AdminDepartment[] = [DEPARTMENT]) {
  mockAiQuery.mockReturnValue({
    data: items,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <AiDepartmentsView />
    </MemoryRouter>,
  );
}

describe('AiDepartmentsView', () => {
  it('shows name, default model and limit read-only', () => {
    renderView();

    expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute(
      'href',
      '/admin/ai/departments/dir-1',
    );
    expect(screen.getByText('label:gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('$12,50')).toBeInTheDocument();
  });

  it('shows inheritance texts when the model and limit are not set', () => {
    renderView([{ ...DEPARTMENT, defaultModel: null, defaultLimits: { dailyCostUsd: null } }]);

    expect(screen.getAllByText('com_admin_departments_models_inherit')).toHaveLength(1);
    expect(screen.getAllByText('com_admin_departments_limits_inherit')).toHaveLength(1);
  });

  it('has no create or delete controls', () => {
    renderView();

    expect(screen.queryByText('com_admin_departments_create')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_admin_departments_delete')).not.toBeInTheDocument();
  });

  it('opens the ai page by directoryId when the row is clicked', () => {
    renderView();

    fireEvent.click(screen.getByText('label:gpt-4o'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/ai/departments/dir-1');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('does not offer a link for a department without a directory pair', () => {
    renderView([{ ...DEPARTMENT, directoryId: null }]);

    expect(screen.queryByRole('link', { name: 'Legal' })).not.toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });
});
