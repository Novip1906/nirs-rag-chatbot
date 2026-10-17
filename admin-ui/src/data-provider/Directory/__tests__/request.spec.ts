import { request as httpRequest } from '../../http';
import {
  createDirectoryDepartment,
  createDirectoryEmployee,
  deleteDirectoryDepartment,
  deleteDirectoryEmployee,
  getDirectoryDepartments,
  getDirectoryEmployee,
  getDirectoryEmployees,
  getDirectoryMe,
  inviteDirectoryEmployee,
  resetDirectoryPassword,
  revokeDirectoryInvite,
  updateDirectoryDepartment,
  updateDirectoryEmployee,
} from '../request';

jest.mock('../../../config', () => ({
  adminApiUrl: () => '/api',
}));

jest.mock('../../http', () => ({
  request: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const http = httpRequest as unknown as Record<
  'get' | 'post' | 'put' | 'patch' | 'delete',
  jest.Mock
>;

const BASE = '/api/admin/v1';

describe('directory request', () => {
  it('reads the current employee from /me', async () => {
    http.get.mockResolvedValue({ employee: null, is_admin: true });

    await expect(getDirectoryMe()).resolves.toEqual({ employee: null, is_admin: true });
    expect(http.get).toHaveBeenCalledWith(`${BASE}/me`, { timeout: 15_000 });
  });

  it('lists employees with only the filters that are set', async () => {
    http.get.mockResolvedValue({ items: [], total: 0 });

    await getDirectoryEmployees({
      q: '',
      department_id: 'none',
      status: undefined,
      page: 2,
      page_size: 20,
    });

    expect(http.get).toHaveBeenCalledWith(`${BASE}/employees`, {
      params: { department_id: 'none', page: 2, page_size: 20 },
    });
  });

  it('passes search and status through', async () => {
    http.get.mockResolvedValue({ items: [], total: 0 });

    await getDirectoryEmployees({ q: 'ivan', status: 'blocked', page: 1, page_size: 10 });

    expect(http.get).toHaveBeenCalledWith(`${BASE}/employees`, {
      params: { q: 'ivan', status: 'blocked', page: 1, page_size: 10 },
    });
  });

  it('reads one employee by id', async () => {
    http.get.mockResolvedValue({ id: 'e/1' });

    await getDirectoryEmployee('e/1');

    expect(http.get).toHaveBeenCalledWith(`${BASE}/employees/e%2F1`);
  });

  it('creates an employee', async () => {
    const input = {
      email: 'a@b.c',
      first_name: 'A',
      last_name: 'B',
      position: '',
      department_id: null,
    };
    const invite = { employee: { id: 'e1' }, invite_link: 'https://l', email_sent: true };
    http.post.mockResolvedValue(invite);

    await expect(createDirectoryEmployee(input)).resolves.toEqual(invite);
    expect(http.post).toHaveBeenCalledWith(`${BASE}/employees`, input);
  });

  it('patches an employee, keeping an explicit null department', async () => {
    http.patch.mockResolvedValue({ id: 'e1' });

    await updateDirectoryEmployee('e1', { department_id: null, blocked: true });

    expect(http.patch).toHaveBeenCalledWith(`${BASE}/employees/e1`, {
      department_id: null,
      blocked: true,
    });
  });

  it('deletes an employee', async () => {
    http.delete.mockResolvedValue(undefined);

    await deleteDirectoryEmployee('e1');

    expect(http.delete).toHaveBeenCalledWith(`${BASE}/employees/e1`);
  });

  it('resets a password with an empty post', async () => {
    http.post.mockResolvedValue({ temporary_password: 'pw' });

    await expect(resetDirectoryPassword('e1')).resolves.toEqual({ temporary_password: 'pw' });
    expect(http.post).toHaveBeenCalledWith(`${BASE}/employees/e1/reset-password`, {});
  });

  it('lists departments and unwraps items', async () => {
    http.get.mockResolvedValue({ items: [{ id: 'd1' }] });

    await expect(getDirectoryDepartments()).resolves.toEqual([{ id: 'd1' }]);
    expect(http.get).toHaveBeenCalledWith(`${BASE}/departments`);
  });

  it('creates, patches and deletes a department', async () => {
    http.post.mockResolvedValue({ id: 'd1' });
    http.patch.mockResolvedValue({ id: 'd1' });
    http.delete.mockResolvedValue(undefined);

    await createDirectoryDepartment({ name: 'IT', description: '' });
    await updateDirectoryDepartment('d1', { name: 'Ops' });
    await deleteDirectoryDepartment('d1');

    expect(http.post).toHaveBeenCalledWith(`${BASE}/departments`, { name: 'IT', description: '' });
    expect(http.patch).toHaveBeenCalledWith(`${BASE}/departments/d1`, { name: 'Ops' });
    expect(http.delete).toHaveBeenCalledWith(`${BASE}/departments/d1`);
  });

  it('re-invites with an email only when one is given', async () => {
    http.post.mockResolvedValue({ employee: { id: 'e1' }, invite_link: 'https://l', email_sent: true });

    await inviteDirectoryEmployee('e 1');
    await inviteDirectoryEmployee('e 1', 'new@example.test');

    expect(http.post).toHaveBeenNthCalledWith(1, `${BASE}/employees/e%201/invite`, {});
    expect(http.post).toHaveBeenNthCalledWith(2, `${BASE}/employees/e%201/invite`, {
      email: 'new@example.test',
    });
  });

  it('revokes an invite with the only_invited guard', async () => {
    http.delete.mockResolvedValue(undefined);

    await expect(revokeDirectoryInvite('e1')).resolves.toBeUndefined();

    expect(http.delete).toHaveBeenCalledWith(`${BASE}/employees/e1`, {
      params: { only_invited: true },
    });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('passes the already_active refusal of a revoke on to the caller', async () => {
    const refusal = { response: { status: 409, data: { error_code: 'already_active' } } };
    http.delete.mockRejectedValue(refusal);

    await expect(revokeDirectoryInvite('e1')).rejects.toBe(refusal);
  });
});
