import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import type { DirectoryDepartment } from '~/types/directory';
import DepartmentsView from '../DepartmentsView';

const mockDepartmentsQuery = jest.fn();
const mockDelete = jest.fn();
const mockNavigate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryDepartmentsQuery: () => mockDepartmentsQuery(),
  useDeleteDirectoryDepartmentMutation: () => ({ mutate: mockDelete, isLoading: false }),
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
  return createEmployeesClientMock((...args: unknown[]) => mockShowToast(...args));
});

function department(overrides: Partial<DirectoryDepartment> = {}): DirectoryDepartment {
  return {
    id: 'dept-1',
    name: 'Legal',
    description: 'Legal team',
    employees_count: 0,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...overrides,
  };
}

function renderView(items: DirectoryDepartment[] = [department()]) {
  mockDepartmentsQuery.mockReturnValue({
    data: items,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <DepartmentsView />
    </MemoryRouter>,
  );
}

describe('DepartmentsView', () => {
  it('shows name, description and employees count', () => {
    renderView([department({ employees_count: 7 })]);

    expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute(
      'href',
      '/admin/departments/dept-1',
    );
    expect(screen.getByText('Legal team')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('links the add button to the create page', () => {
    renderView();

    expect(screen.getByText('com_admin_departments_create').closest('a')).toHaveAttribute(
      'href',
      '/admin/departments/new',
    );
  });

  it('navigates exactly once when clicking the edit button', () => {
    renderView();

    fireEvent.click(screen.getByLabelText('com_admin_departments_edit'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/departments/dept-1');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('delete disabled when not empty', () => {
    renderView([department({ employees_count: 2 })]);

    const button = screen.getByLabelText('com_admin_departments_delete');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'com_admin_departments_delete_not_empty');
    fireEvent.click(button);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirms before deleting an empty department', () => {
    renderView();

    fireEvent.click(screen.getByLabelText('com_admin_departments_delete'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('com_admin_departments_delete_title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('com_admin_action_delete'));
    expect(mockDelete.mock.calls[0][0]).toBe('dept-1');
  });

  it('shows department_not_empty when the service still answers 409', () => {
    mockDelete.mockImplementation((_id, options?: { onError?: (error: unknown) => void }) => {
      const error = new AxiosError('conflict');
      error.response = {
        status: 409,
        data: { error_code: 'department_not_empty', message: 'x' },
        statusText: '',
        headers: {},
        config: {} as never,
      };
      options?.onError?.(error);
    });
    renderView();

    fireEvent.click(screen.getByLabelText('com_admin_departments_delete'));
    fireEvent.click(screen.getByText('com_admin_action_delete'));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_admin_directory_error_department_not_empty',
      status: 'error',
    });
  });

  it('shows the empty state', () => {
    renderView([]);

    expect(screen.getByText('com_admin_departments_empty_title')).toBeInTheDocument();
  });
});
