import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AxiosError } from 'axios';
import type { DirectoryDepartment } from '~/types/directory';
import DepartmentEditPage from '../DepartmentEditPage';

const mockDepartmentsQuery = jest.fn();
const mockUpdate = jest.fn();
const mockNavigate = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryDepartmentsQuery: () => mockDepartmentsQuery(),
  useUpdateDirectoryDepartmentMutation: () => ({ mutate: mockUpdate, isLoading: false }),
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

const DEPARTMENT: DirectoryDepartment = {
  id: 'dept-1',
  name: 'Legal',
  description: 'Legal team',
  employees_count: 3,
  created_at: '',
  updated_at: '',
  deleted_at: null,
};

function renderPage(path = '/admin/departments/dept-1', items = [DEPARTMENT]) {
  mockDepartmentsQuery.mockReturnValue({
    data: items,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/departments/:id" element={<DepartmentEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DepartmentEditPage', () => {
  it('picks up fresh data while untouched and keeps edits afterwards', () => {
    const view = renderPage();

    mockDepartmentsQuery.mockReturnValue({
      data: [{ ...DEPARTMENT, name: 'Legal 2', updated_at: '2026-10-02T10:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    view.rerender(
      <MemoryRouter initialEntries={['/admin/departments/dept-1']}>
        <Routes>
          <Route path="/admin/departments/:id" element={<DepartmentEditPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue('Legal 2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_name'), {
      target: { value: 'Mine' },
    });
    mockDepartmentsQuery.mockReturnValue({
      data: [{ ...DEPARTMENT, name: 'Legal 3', updated_at: '2026-10-03T10:00:00Z' }],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    view.rerender(
      <MemoryRouter initialEntries={['/admin/departments/dept-1']}>
        <Routes>
          <Route path="/admin/departments/:id" element={<DepartmentEditPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue('Mine')).toBeInTheDocument();
  });

  it('renders the form pre-filled from the matching department', () => {
    renderPage();

    expect(screen.getByDisplayValue('Legal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Legal team')).toBeInTheDocument();
  });

  it('renames', () => {
    mockUpdate.mockImplementation((_vars, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_name'), {
      target: { value: 'Legal and Compliance' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      id: 'dept-1',
      input: { name: 'Legal and Compliance' },
    });
    expect(mockNavigate).toHaveBeenCalledWith('/admin/departments');
  });

  it('shows department_name_taken', () => {
    mockUpdate.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) => {
      const error = new AxiosError('conflict');
      error.response = {
        status: 409,
        data: { error_code: 'department_name_taken', message: 'x' },
        statusText: '',
        headers: {},
        config: {} as never,
      };
      options?.onError?.(error);
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_name'), {
      target: { value: 'Finance' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(screen.getByText('com_admin_directory_error_department_name_taken')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to ai settings of the department', () => {
    renderPage();

    expect(screen.getByText('com_admin_departments_ai_settings').closest('a')).toHaveAttribute(
      'href',
      '/admin/ai/departments/dept-1',
    );
  });

  it('shows an error with a link back when the id has no matching department', () => {
    renderPage('/admin/departments/missing-id');

    expect(screen.getByText('com_admin_departments_not_found')).toBeInTheDocument();
  });
});
