import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { adminKeys } from '../../Admin/keys';
import { directoryKeys } from '../keys';
import {
  useCreateDirectoryDepartmentMutation,
  useCreateDirectoryEmployeeMutation,
  useDeleteDirectoryDepartmentMutation,
  useDeleteDirectoryEmployeeMutation,
  useInviteDirectoryEmployeeMutation,
  useRevokeDirectoryInviteMutation,
  useUpdateDirectoryDepartmentMutation,
  useUpdateDirectoryEmployeeMutation,
} from '../mutations';
import {
  createDirectoryDepartment,
  createDirectoryEmployee,
  deleteDirectoryDepartment,
  deleteDirectoryEmployee,
  inviteDirectoryEmployee,
  revokeDirectoryInvite,
  updateDirectoryDepartment,
  updateDirectoryEmployee,
} from '../request';

jest.mock('../request');

function setup() {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

describe('directory mutations', () => {
  it('refreshes employee lists and department counters after creating an employee', async () => {
    const { invalidate, wrapper } = setup();
    (createDirectoryEmployee as jest.Mock).mockResolvedValue({
      employee: { id: 'e1' },
      invite_link: 'https://l',
      email_sent: true,
    });
    const { result } = renderHook(() => useCreateDirectoryEmployeeMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        email: 'a@b.c',
        first_name: 'A',
        last_name: 'B',
        position: '',
        department_id: null,
      });
    });

    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employeesRoot);
    expect(invalidate).toHaveBeenCalledWith(directoryKeys.departments);
  });

  it('stores the updated employee and refreshes lists and me', async () => {
    const { client, invalidate, wrapper } = setup();
    (updateDirectoryEmployee as jest.Mock).mockResolvedValue({ id: 'e1', blocked: true });
    const { result } = renderHook(() => useUpdateDirectoryEmployeeMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', input: { blocked: true } });
    });

    expect(updateDirectoryEmployee).toHaveBeenCalledWith('e1', { blocked: true });
    expect(client.getQueryData(directoryKeys.employee('e1'))).toEqual({ id: 'e1', blocked: true });
    expect(invalidate).toHaveBeenCalledWith(directoryKeys.me);
  });

  it.each([
    [
      'create employee',
      useCreateDirectoryEmployeeMutation,
      createDirectoryEmployee,
      { email: 'a@b.c', first_name: 'A', last_name: 'B', position: '', department_id: null },
    ],
    [
      'update employee',
      useUpdateDirectoryEmployeeMutation,
      updateDirectoryEmployee,
      { id: 'e1', input: { position: 'CEO' } },
    ],
    ['delete employee', useDeleteDirectoryEmployeeMutation, deleteDirectoryEmployee, 'e1'],
    [
      'create department',
      useCreateDirectoryDepartmentMutation,
      createDirectoryDepartment,
      { name: 'Legal', description: '' },
    ],
    [
      'update department',
      useUpdateDirectoryDepartmentMutation,
      updateDirectoryDepartment,
      { id: 'd1', input: { name: 'Legal' } },
    ],
    ['delete department', useDeleteDirectoryDepartmentMutation, deleteDirectoryDepartment, 'd1'],
  ])('refreshes the ai lists and cards after %s', async (_name, useMutationHook, request, input) => {
    const { invalidate, wrapper } = setup();
    (request as jest.Mock).mockResolvedValue({ id: 'x' });
    const { result } = renderHook(() => (useMutationHook as () => any)(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(invalidate).toHaveBeenCalledWith(adminKeys.usersRoot);
    expect(invalidate).toHaveBeenCalledWith(adminKeys.userRoot);
    expect(invalidate).toHaveBeenCalledWith(adminKeys.departments);
  });

  it('refreshes employee lists after a failed re-invite', async () => {
    const { invalidate, wrapper } = setup();
    (inviteDirectoryEmployee as jest.Mock).mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useInviteDirectoryEmployeeMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'e1' }).catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employeesRoot);
    expect(invalidate).toHaveBeenCalledWith(directoryKeys.departments);
  });

  it('stores the re-invited employee', async () => {
    const { client, wrapper } = setup();
    (inviteDirectoryEmployee as jest.Mock).mockResolvedValue({
      employee: { id: 'e1', status: 'invited' },
      invite_link: 'https://l',
      email_sent: true,
    });
    const { result } = renderHook(() => useInviteDirectoryEmployeeMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', email: 'new@example.test' });
    });

    expect(inviteDirectoryEmployee).toHaveBeenCalledWith('e1', 'new@example.test');
    expect(client.getQueryData(directoryKeys.employee('e1'))).toEqual({
      id: 'e1',
      status: 'invited',
    });
  });

  it('refreshes lists and counters after a revoke', async () => {
    const { invalidate, wrapper } = setup();
    (revokeDirectoryInvite as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useRevokeDirectoryInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('e1');
    });

    expect(revokeDirectoryInvite).toHaveBeenCalledWith('e1');
    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employeesRoot);
    expect(invalidate).toHaveBeenCalledWith(directoryKeys.departments);
  });

  it('refreshes lists after a refused revoke', async () => {
    const { invalidate, wrapper } = setup();
    (revokeDirectoryInvite as jest.Mock).mockRejectedValue(new Error('already_active'));
    const { result } = renderHook(() => useRevokeDirectoryInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('e1').catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employeesRoot);
  });

  it('refreshes the employee card after a refused re-invite', async () => {
    const { invalidate, wrapper } = setup();
    (inviteDirectoryEmployee as jest.Mock).mockRejectedValue(new Error('already_active'));
    const { result } = renderHook(() => useInviteDirectoryEmployeeMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'e1' }).catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employee('e1'));
  });

  it('refreshes the employee card after a refused revoke', async () => {
    const { invalidate, wrapper } = setup();
    (revokeDirectoryInvite as jest.Mock).mockRejectedValue(new Error('already_active'));
    const { result } = renderHook(() => useRevokeDirectoryInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('e1').catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith(directoryKeys.employee('e1'));
  });
});
