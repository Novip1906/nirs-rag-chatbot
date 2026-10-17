import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import DepartmentCreatePage from '../DepartmentCreatePage';

const mockCreate = jest.fn();
const mockNavigate = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useCreateDirectoryDepartmentMutation: () => ({ mutate: mockCreate, isLoading: false }),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <DepartmentCreatePage />
    </MemoryRouter>,
  );
}

describe('DepartmentCreatePage', () => {
  it('creates', () => {
    mockCreate.mockImplementation((_input, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_name'), {
      target: { value: 'Legal' },
    });
    fireEvent.change(screen.getByLabelText('com_admin_departments_field_description'), {
      target: { value: 'Legal team' },
    });
    fireEvent.click(screen.getByText('com_admin_departments_create_submit'));

    expect(mockCreate.mock.calls[0][0]).toEqual({ name: 'Legal', description: 'Legal team' });
    expect(mockNavigate).toHaveBeenCalledWith('/admin/departments');
  });

  it('shows department_name_taken', () => {
    mockCreate.mockImplementation((_input, options?: { onError?: (error: unknown) => void }) => {
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
      target: { value: 'Legal' },
    });
    fireEvent.click(screen.getByText('com_admin_departments_create_submit'));

    expect(screen.getByText('com_admin_directory_error_department_name_taken')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows a field error under the name', () => {
    mockCreate.mockImplementation((_input, options?: { onError?: (error: unknown) => void }) => {
      const error = new AxiosError('bad');
      error.response = {
        status: 400,
        data: {
          error_code: 'validation_failed',
          message: 'x',
          fields: { name: 'too_long' },
        },
        statusText: '',
        headers: {},
        config: {} as never,
      };
      options?.onError?.(error);
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_departments_field_name'), {
      target: { value: 'L' },
    });
    fireEvent.click(screen.getByText('com_admin_departments_create_submit'));

    expect(screen.getByText('com_admin_directory_field_too_long')).toBeInTheDocument();
  });

  it('is a narrow card without AI fields', () => {
    renderPage();

    expect(
      screen.getByLabelText('com_admin_departments_field_name').closest('section'),
    ).toHaveClass('max-w-2xl');
    expect(screen.queryByLabelText('com_admin_departments_field_prompt')).not.toBeInTheDocument();
  });
});
