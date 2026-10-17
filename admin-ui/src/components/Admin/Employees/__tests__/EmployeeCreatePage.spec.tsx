import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import EmployeeCreatePage from '../EmployeeCreatePage';

const mockCreate = jest.fn();
const mockCreateReset = jest.fn();
const mockNavigate = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryDepartmentsQuery: () => ({ data: [{ id: 'dept-1', name: 'Legal' }] }),
  useCreateDirectoryEmployeeMutation: () => ({
    mutate: mockCreate,
    reset: mockCreateReset,
    isLoading: false,
  }),
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

function fillRequired() {
  fireEvent.change(screen.getByLabelText('com_admin_employees_field_first_name'), {
    target: { value: 'Ivan' },
  });
  fireEvent.change(screen.getByLabelText('com_admin_employees_field_last_name'), {
    target: { value: 'Petrov' },
  });
  fireEvent.change(screen.getByLabelText('com_admin_employees_field_email'), {
    target: { value: 'ivan@example.test' },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeeCreatePage />
    </MemoryRouter>,
  );
}

describe('EmployeeCreatePage', () => {
  it('shows the invite link after create and opens the card on close', () => {
    mockCreate.mockImplementation(
      (
        _input,
        options?: {
          onSuccess?: (data: {
            employee: { id: string; email: string };
            invite_link: string;
            email_sent: boolean;
          }) => void;
        },
      ) =>
        options?.onSuccess?.({
          employee: { id: 'new-1', email: 'ivan@example.test' },
          invite_link: 'https://auth.example.test/i/1',
          email_sent: true,
        }),
    );
    renderPage();

    fillRequired();
    fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
      target: { value: 'dept-1' },
    });
    fireEvent.click(screen.getByText('com_admin_employees_create_submit'));

    expect(mockCreate.mock.calls[0][0]).toEqual({
      email: 'ivan@example.test',
      first_name: 'Ivan',
      last_name: 'Petrov',
      position: '',
      department_id: 'dept-1',
    });
    expect(screen.getByDisplayValue('https://auth.example.test/i/1')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('com_admin_action_done'));
    expect(mockCreateReset).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/new-1');
    expect(screen.queryByDisplayValue('https://auth.example.test/i/1')).not.toBeInTheDocument();
  });

  it('creates an employee without a last name', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_first_name'), {
      target: { value: 'Ivan' },
    });
    fireEvent.change(screen.getByLabelText('com_admin_employees_field_email'), {
      target: { value: 'ivan@example.test' },
    });
    fireEvent.click(screen.getByText('com_admin_employees_create_submit'));

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('last_name');
    expect(screen.getByLabelText('com_admin_employees_field_last_name')).not.toBeRequired();
  });

  it('sends null department when none is selected', () => {
    renderPage();

    fillRequired();
    fireEvent.click(screen.getByText('com_admin_employees_create_submit'));

    expect(mockCreate.mock.calls[0][0]).toMatchObject({ department_id: null });
  });

  it('shows the service error and field errors', () => {
    mockCreate.mockImplementation((_input, options?: { onError?: (error: unknown) => void }) => {
      const error = new AxiosError('failed');
      error.response = {
        status: 409,
        data: { error_code: 'email_taken', message: 'x', fields: { email: 'invalid' } },
        statusText: '',
        headers: {},
        config: {} as never,
      };
      options?.onError?.(error);
    });
    renderPage();

    fillRequired();
    fireEvent.click(screen.getByText('com_admin_employees_create_submit'));

    expect(screen.getByText('com_admin_directory_error_email_taken')).toBeInTheDocument();
    expect(screen.getByText('com_admin_directory_field_invalid')).toBeInTheDocument();
  });

  it('uses a narrow single card', () => {
    renderPage();

    expect(
      screen.getByLabelText('com_admin_employees_field_email').closest('section'),
    ).toHaveClass('max-w-2xl');
  });
});
