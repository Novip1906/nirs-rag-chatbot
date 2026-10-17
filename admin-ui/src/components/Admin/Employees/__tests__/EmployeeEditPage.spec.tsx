import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AxiosError } from 'axios';
import type { DirectoryEmployee, DirectoryInvite } from '~/types/directory';
import { directoryEmployee } from '~/components/Admin/__fixtures__/employee';
import EmployeeEditPage from '../EmployeeEditPage';

const mockEmployeeQuery = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockInvite = jest.fn();
const mockInviteReset = jest.fn();
const mockRevoke = jest.fn();
const mockReset = jest.fn();
const mockResetMutation = jest.fn();
const mockResetLoading = { value: false };
const mockNavigate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryEmployeeQuery: (id: string) => mockEmployeeQuery(id),
  useDirectoryDepartmentsQuery: () => ({
    data: [
      { id: 'dept-1', name: 'Legal' },
      { id: 'dept-2', name: 'Finance' },
    ],
  }),
  useUpdateDirectoryEmployeeMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useDeleteDirectoryEmployeeMutation: () => ({ mutate: mockDelete, isLoading: false }),
  useInviteDirectoryEmployeeMutation: () => ({
    mutate: mockInvite,
    reset: mockInviteReset,
    isLoading: false,
  }),
  useRevokeDirectoryInviteMutation: () => ({ mutate: mockRevoke, isLoading: false }),
  useResetDirectoryPasswordMutation: () => ({
    mutate: mockReset,
    reset: mockResetMutation,
    isLoading: mockResetLoading.value,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { id: 'sub-me' } }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@librechat/client', () => {
  const { createEmployeesClientMock } = jest.requireActual('test/employeesClientMock');
  return createEmployeesClientMock((...args: unknown[]) => mockShowToast(...args));
});

const EMPLOYEE: DirectoryEmployee = directoryEmployee({ updated_at: '2026-10-01T10:00:00Z' });

function mockEmployee(employee: DirectoryEmployee) {
  mockEmployeeQuery.mockReturnValue({
    data: employee,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
}

function pageElement() {
  return (
    <MemoryRouter initialEntries={['/admin/users/emp-1']}>
      <Routes>
        <Route path="/admin/users/:id" element={<EmployeeEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(employee: DirectoryEmployee = EMPLOYEE) {
  mockEmployee(employee);
  return render(pageElement());
}

function directoryError(status: number, body: Record<string, unknown>): AxiosError {
  const error = new AxiosError('failed');
  error.response = { status, data: body, statusText: '', headers: {}, config: {} as never };
  return error;
}

describe('EmployeeEditPage', () => {
  it('renders the profile and access cards', () => {
    renderPage();

    expect(screen.getByLabelText('com_admin_employees_field_first_name')).toHaveValue('Ivan');
    expect(screen.getByLabelText('com_admin_employees_field_last_name')).toHaveValue('Petrov');
    expect(screen.getByLabelText('com_admin_employees_field_email')).toHaveValue(
      'ivan@example.test',
    );
    expect(screen.getByLabelText('com_admin_employees_field_position')).toHaveValue('CTO');
    expect(screen.getByLabelText('com_admin_employees_field_department')).toHaveValue('dept-1');
    expect(screen.getByLabelText('com_admin_employees_admin')).not.toBeChecked();
    expect(screen.getByLabelText('com_admin_employees_blocked')).not.toBeChecked();
  });

  it('sends only changed fields', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_position'), {
      target: { value: 'CEO' },
    });
    fireEvent.click(screen.getByLabelText('com_admin_employees_admin'));
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      id: 'emp-1',
      input: { position: 'CEO', is_admin: true },
    });
  });

  it('disables save while nothing is changed', () => {
    renderPage();

    expect(screen.getByText('com_admin_action_save')).toBeDisabled();
  });

  it('saves employee without department and position', () => {
    renderPage({ ...EMPLOYEE, position: '', department_id: null });

    expect(screen.getByLabelText('com_admin_employees_field_department')).toHaveValue('none');
    fireEvent.change(screen.getByLabelText('com_admin_employees_field_first_name'), {
      target: { value: 'Petr' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'emp-1', input: { first_name: 'Petr' } });
  });

  it('clears department with null', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
      target: { value: 'none' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'emp-1', input: { department_id: null } });
  });

  it('navigates to the list after a successful save', () => {
    mockUpdate.mockImplementation((_vars, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_position'), {
      target: { value: 'CEO' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
  });

  it('shows field error from server', () => {
    mockUpdate.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
      options?.onError?.(
        directoryError(400, {
          error_code: 'validation_failed',
          message: 'x',
          fields: { email: 'invalid' },
        }),
      ),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_email'), {
      target: { value: 'broken@x' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(screen.getByText('com_admin_directory_field_invalid')).toBeInTheDocument();
    expect(screen.getByText('com_admin_directory_error_validation_failed')).toBeInTheDocument();
  });

  it('shows the error text for a service error code', () => {
    mockUpdate.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
      options?.onError?.(directoryError(409, { error_code: 'email_taken', message: 'x' })),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_email'), {
      target: { value: 'taken@example.test' },
    });
    fireEvent.click(screen.getByText('com_admin_action_save'));

    expect(screen.getByText('com_admin_directory_error_email_taken')).toBeInTheDocument();
  });

  it('disables admin and block controls for own card', () => {
    renderPage({ ...EMPLOYEE, sub: 'sub-me' });

    expect(screen.getByLabelText('com_admin_employees_admin')).toBeDisabled();
    expect(screen.getByLabelText('com_admin_employees_blocked')).toBeDisabled();
    expect(screen.getByText('com_admin_employees_own_card_hint')).toBeInTheDocument();
  });

  it('disables delete for own card', () => {
    renderPage({ ...EMPLOYEE, sub: 'sub-me' });

    const button = screen.getByText('com_admin_employees_delete_action');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'com_admin_employees_own_card_hint');
  });

  it('keeps delete enabled for another employee', () => {
    renderPage();

    expect(screen.getByText('com_admin_employees_delete_action')).toBeEnabled();
  });

  it('keeps admin and block controls enabled for another employee', () => {
    renderPage();

    expect(screen.getByLabelText('com_admin_employees_admin')).toBeEnabled();
    expect(screen.getByLabelText('com_admin_employees_blocked')).toBeEnabled();
    expect(screen.queryByText('com_admin_employees_own_card_hint')).not.toBeInTheDocument();
  });

  it('confirms before delete', () => {
    renderPage();

    fireEvent.click(screen.getByText('com_admin_employees_delete_action'));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('com_admin_action_delete'));
    expect(mockDelete.mock.calls[0][0]).toBe('emp-1');
  });

  it('links to ai settings', () => {
    renderPage();

    expect(screen.getByText('com_admin_employees_ai_settings').closest('a')).toHaveAttribute(
      'href',
      '/admin/ai/users/emp-1',
    );
  });

  it('resets the password after confirmation and shows it once', () => {
    mockReset.mockImplementation(
      (_id, options?: { onSuccess?: (data: { temporary_password: string }) => void }) =>
        options?.onSuccess?.({ temporary_password: 'Tmp-Pass-1' }),
    );
    renderPage();

    fireEvent.click(screen.getByText('com_admin_employees_reset_password_action'));
    expect(mockReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('com_admin_employees_reset_password_confirm'));
    expect(mockReset.mock.calls[0][0]).toBe('emp-1');
    expect(screen.getByText('Tmp-Pass-1')).toBeInTheDocument();
  });

  it('shows not found for an unknown employee', () => {
    mockEmployeeQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: directoryError(404, { error_code: 'not_found', message: 'x' }),
      refetch: jest.fn(),
    });
    render(
      <MemoryRouter initialEntries={['/admin/users/emp-1']}>
        <Routes>
          <Route path="/admin/users/:id" element={<EmployeeEditPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('com_admin_employees_not_found')).toBeInTheDocument();
  });

  it('picks up fresh data while untouched', () => {
    const view = renderPage();

    mockEmployee({ ...EMPLOYEE, position: 'CEO', updated_at: '2026-10-02T10:00:00Z' });
    view.rerender(pageElement());

    expect(screen.getByLabelText('com_admin_employees_field_position')).toHaveValue('CEO');
  });

  it('keeps user edits on background refetch', () => {
    const view = renderPage();

    fireEvent.change(screen.getByLabelText('com_admin_employees_field_first_name'), {
      target: { value: 'Petr' },
    });
    mockEmployee({
      ...EMPLOYEE,
      first_name: 'Other',
      position: 'CEO',
      updated_at: '2026-10-02T10:00:00Z',
    });
    view.rerender(pageElement());

    expect(screen.getByLabelText('com_admin_employees_field_first_name')).toHaveValue('Petr');
    fireEvent.click(screen.getByText('com_admin_action_save'));
    expect(mockUpdate.mock.calls[0][0].input).toEqual({ first_name: 'Petr' });
  });

  it('disables the password reset button while the request runs', () => {
    mockResetLoading.value = true;
    renderPage();

    expect(screen.getByText('com_admin_employees_reset_password_action')).toBeDisabled();
    mockResetLoading.value = false;
  });

  it('disables the password reset for own card with a hint', () => {
    renderPage({ ...EMPLOYEE, sub: 'sub-me' });

    const button = screen.getByText('com_admin_employees_reset_password_action');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'com_admin_employees_reset_password_own_hint');
  });

  it('clears the mutation data when the password dialog closes', () => {
    mockReset.mockImplementation(
      (_id, options?: { onSuccess?: (data: { temporary_password: string }) => void }) =>
        options?.onSuccess?.({ temporary_password: 'Tmp-Pass-1' }),
    );
    renderPage();

    fireEvent.click(screen.getByText('com_admin_employees_reset_password_action'));
    fireEvent.click(screen.getByText('com_admin_employees_reset_password_confirm'));
    fireEvent.click(screen.getByText('com_admin_action_done'));

    expect(mockResetMutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tmp-Pass-1')).not.toBeInTheDocument();
  });

  it('temporary password dialog survives a background refetch', () => {
    mockReset.mockImplementation(
      (_id, options?: { onSuccess?: (data: { temporary_password: string }) => void }) =>
        options?.onSuccess?.({ temporary_password: 'Tmp-Pass-1' }),
    );
    const view = renderPage();

    fireEvent.click(screen.getByText('com_admin_employees_reset_password_action'));
    fireEvent.click(screen.getByText('com_admin_employees_reset_password_confirm'));
    expect(screen.getByText('Tmp-Pass-1')).toBeInTheDocument();

    mockEmployee({ ...EMPLOYEE, position: 'CEO', updated_at: '2026-10-02T10:00:00Z' });
    view.rerender(pageElement());

    expect(screen.getByText('Tmp-Pass-1')).toBeInTheDocument();
  });

  it('delete confirmation survives a background refetch', () => {
    const view = renderPage();

    fireEvent.click(screen.getByText('com_admin_employees_delete_action'));
    expect(screen.getByText('com_admin_employees_delete_title')).toBeInTheDocument();

    mockEmployee({ ...EMPLOYEE, position: 'CEO', updated_at: '2026-10-02T10:00:00Z' });
    view.rerender(pageElement());

    expect(screen.getByText('com_admin_employees_delete_title')).toBeInTheDocument();
  });

  describe('department head and invitations', () => {
    const PENDING = directoryEmployee({
      status: 'invited',
      activated_at: null,
      updated_at: '2026-10-01T10:00:00Z',
    });

    it('renders the status tag in the access card', () => {
      renderPage();

      expect(screen.getByText('com_admin_employees_status_active')).toBeInTheDocument();
    });

    it('does not send is_head when the department changes and clears the checkbox', () => {
      renderPage(directoryEmployee({ is_head: true }));
      expect(screen.getByLabelText('com_admin_employees_head')).toBeChecked();

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
        target: { value: 'dept-2' },
      });

      expect(screen.getByLabelText('com_admin_employees_head')).not.toBeChecked();
      fireEvent.click(screen.getByText('com_admin_action_save'));

      expect(mockUpdate.mock.calls[0][0]).toEqual({
        id: 'emp-1',
        input: { department_id: 'dept-2' },
      });
    });

    it('sends is_head when the box is ticked again after a department change', () => {
      renderPage(directoryEmployee({ is_head: true }));

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
        target: { value: 'dept-2' },
      });
      fireEvent.click(screen.getByLabelText('com_admin_employees_head'));
      fireEvent.click(screen.getByText('com_admin_action_save'));

      expect(mockUpdate.mock.calls[0][0]).toEqual({
        id: 'emp-1',
        input: { department_id: 'dept-2', is_head: true },
      });
    });

    it('restores the head flag when the department is switched back', () => {
      renderPage(directoryEmployee({ is_head: true }));

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
        target: { value: 'dept-2' },
      });
      fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
        target: { value: 'dept-1' },
      });

      expect(screen.getByLabelText('com_admin_employees_head')).toBeChecked();
      expect(screen.getByText('com_admin_action_save')).toBeDisabled();
    });

    it('sets the head flag', () => {
      renderPage();

      fireEvent.click(screen.getByLabelText('com_admin_employees_head'));
      fireEvent.click(screen.getByText('com_admin_action_save'));

      expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'emp-1', input: { is_head: true } });
    });

    it('disables the head checkbox without a department and clears the flag', () => {
      renderPage(directoryEmployee({ is_head: true }));

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_department'), {
        target: { value: 'none' },
      });

      expect(screen.getByLabelText('com_admin_employees_head')).toBeDisabled();
      expect(screen.getByLabelText('com_admin_employees_head')).not.toBeChecked();
      expect(screen.getByText('com_admin_employees_head_no_department')).toBeInTheDocument();
      fireEvent.click(screen.getByText('com_admin_action_save'));
      expect(mockUpdate.mock.calls[0][0]).toEqual({
        id: 'emp-1',
        input: { department_id: null },
      });
    });

    it('saves an employee without a last name', () => {
      renderPage();

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_last_name'), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByText('com_admin_action_save'));

      expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'emp-1', input: { last_name: '' } });
    });

    it('changes email of a pending employee through re-invite, not patch', () => {
      renderPage(PENDING);
      expect(screen.getByLabelText('com_admin_employees_field_email')).toBeDisabled();
      expect(screen.getByText('com_admin_employees_email_pending_hint')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('com_admin_employees_invite_email'), {
        target: { value: 'new@example.test' },
      });
      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      expect(mockInvite.mock.calls[0][0]).toEqual({ id: 'emp-1', email: 'new@example.test' });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('does not send the email in a patch for a pending employee', () => {
      renderPage(PENDING);

      fireEvent.change(screen.getByLabelText('com_admin_employees_field_position'), {
        target: { value: 'CEO' },
      });
      fireEvent.click(screen.getByText('com_admin_action_save'));

      expect(mockUpdate.mock.calls[0][0]).toEqual({ id: 'emp-1', input: { position: 'CEO' } });
    });

    it('resends without email when it is unchanged', () => {
      renderPage(PENDING);

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      expect(mockInvite.mock.calls[0][0]).toEqual({ id: 'emp-1' });
    });

    it('shows the new invite link and keeps it over a refetch', () => {
      mockInvite.mockImplementation(
        (_vars, options?: { onSuccess?: (data: DirectoryInvite) => void }) =>
          options?.onSuccess?.({
            employee: PENDING,
            invite_link: 'https://auth.example.test/i/2',
            email_sent: true,
          }),
      );
      const view = renderPage(PENDING);

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));
      expect(screen.getByDisplayValue('https://auth.example.test/i/2')).toBeInTheDocument();

      mockEmployee({ ...PENDING, updated_at: '2026-10-02T10:00:00Z' });
      view.rerender(pageElement());
      expect(screen.getByDisplayValue('https://auth.example.test/i/2')).toBeInTheDocument();

      fireEvent.click(screen.getByText('com_admin_action_done'));
      expect(mockInviteReset).toHaveBeenCalledTimes(1);
      expect(screen.queryByDisplayValue('https://auth.example.test/i/2')).not.toBeInTheDocument();
    });

    it('shows the refusal when the employee has already logged in', () => {
      mockInvite.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'already_active', message: 'x' })),
      );
      renderPage(PENDING);

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_directory_error_already_active',
        status: 'error',
      });
    });

    it('disables password reset for an employee who has not logged in', () => {
      renderPage(PENDING);

      const button = screen.getByText('com_admin_employees_reset_password_action');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'com_admin_employees_reset_password_pending_hint');
    });

    it('has no invite block for an active employee', () => {
      renderPage();

      expect(screen.queryByLabelText('com_admin_employees_invite_email')).not.toBeInTheDocument();
      expect(screen.queryByText('com_admin_employees_invite_resend')).not.toBeInTheDocument();
      expect(screen.getByLabelText('com_admin_employees_field_email')).toBeEnabled();
    });

    it('names the delete button revoke for a pending employee and revokes with the guard', () => {
      mockRevoke.mockImplementation((_id, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
      );
      renderPage(PENDING);

      expect(screen.queryByText('com_admin_employees_delete_action')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('com_admin_employees_revoke_action'));
      expect(mockRevoke).not.toHaveBeenCalled();

      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByText('com_admin_employees_invite_revoke_title')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByText('com_admin_employees_revoke_action'));

      expect(mockRevoke.mock.calls[0][0]).toBe('emp-1');
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
    });

    it('shows the refusal when a revoke hits an employee who logged in meanwhile', () => {
      mockRevoke.mockImplementation((_id, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'already_active', message: 'x' })),
      );
      renderPage(PENDING);

      fireEvent.click(screen.getByText('com_admin_employees_revoke_action'));
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByText('com_admin_employees_revoke_action'),
      );

      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_directory_error_already_active',
        status: 'error',
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('treats a blocked employee who never logged in as not logged in', () => {
      renderPage(
        directoryEmployee({ status: 'blocked', blocked: true, activated_at: null }),
      );

      expect(screen.getByLabelText('com_admin_employees_field_email')).toBeDisabled();
      expect(screen.getByLabelText('com_admin_employees_invite_email')).toBeInTheDocument();
      expect(screen.getByText('com_admin_employees_reset_password_action')).toBeDisabled();
      expect(screen.getByText('com_admin_employees_revoke_action')).toBeInTheDocument();
    });

    it('treats a blocked employee who logged in as logged in', () => {
      renderPage(
        directoryEmployee({
          status: 'blocked',
          blocked: true,
          activated_at: '2026-09-01T10:00:00Z',
        }),
      );

      expect(screen.getByLabelText('com_admin_employees_field_email')).toBeEnabled();
      expect(screen.queryByLabelText('com_admin_employees_invite_email')).not.toBeInTheDocument();
      expect(screen.getByText('com_admin_employees_reset_password_action')).toBeEnabled();
    });

    it('shows a taken email next to the invite field', () => {
      mockInvite.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'email_taken', message: 'x' })),
      );
      renderPage(PENDING);

      fireEvent.change(screen.getByLabelText('com_admin_employees_invite_email'), {
        target: { value: 'taken@example.test' },
      });
      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      const field = screen.getByLabelText('com_admin_employees_invite_email');
      expect(field.parentElement?.parentElement).toHaveTextContent(
        'com_admin_directory_error_email_taken',
      );
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_directory_error_email_taken',
        status: 'error',
      });
    });

    it('shows a field error on the email of the re-invite and clears it on edit', () => {
      mockInvite.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(
          directoryError(400, {
            error_code: 'validation_failed',
            message: 'x',
            fields: { email: 'invalid' },
          }),
        ),
      );
      renderPage(PENDING);

      fireEvent.change(screen.getByLabelText('com_admin_employees_invite_email'), {
        target: { value: 'broken@x' },
      });
      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));
      expect(screen.getByText('com_admin_directory_field_invalid')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('com_admin_employees_invite_email'), {
        target: { value: 'fixed@example.test' },
      });
      expect(screen.queryByText('com_admin_directory_field_invalid')).not.toBeInTheDocument();
    });

    it('does not mark the email field for an unrelated invite error', () => {
      mockInvite.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'already_active', message: 'x' })),
      );
      renderPage(PENDING);

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      const field = screen.getByLabelText('com_admin_employees_invite_email');
      expect(field.parentElement?.parentElement).not.toHaveTextContent(
        'com_admin_directory_error_already_active',
      );
    });
  });
});
