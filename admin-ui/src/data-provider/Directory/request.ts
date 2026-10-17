import { adminApiUrl } from '../../config';
import { request } from '../http';
import type {
  DirectoryDepartment,
  DirectoryDepartmentCreateInput,
  DirectoryDepartmentInput,
  DirectoryEmployee,
  DirectoryEmployeeCreateInput,
  DirectoryEmployeeInput,
  DirectoryEmployeesQuery,
  DirectoryEmployeesResponse,
  DirectoryInvite,
  DirectoryMe,
  DirectoryTemporaryPassword,
} from '../../types/directory';

const SERVICE_TIMEOUT_MS = 15_000;

const adminBase = (): string => `${adminApiUrl()}/admin/v1`;

const segment = (value: string): string => encodeURIComponent(value);

export const getDirectoryMe = (): Promise<DirectoryMe> => request.get(`${adminBase()}/me`, { timeout: SERVICE_TIMEOUT_MS });

export const getDirectoryEmployees = ({
  q,
  department_id,
  status,
  page,
  page_size,
}: DirectoryEmployeesQuery): Promise<DirectoryEmployeesResponse> =>
  request.get(`${adminBase()}/employees`, {
    params: {
      ...(q != null && q !== '' ? { q } : {}),
      ...(department_id != null && department_id !== '' ? { department_id } : {}),
      ...(status != null ? { status } : {}),
      page,
      page_size,
    },
  });

export const getDirectoryEmployee = (id: string): Promise<DirectoryEmployee> =>
  request.get(`${adminBase()}/employees/${segment(id)}`);

export const createDirectoryEmployee = (
  input: DirectoryEmployeeCreateInput,
): Promise<DirectoryInvite> => request.post(`${adminBase()}/employees`, input);

export const updateDirectoryEmployee = (
  id: string,
  input: DirectoryEmployeeInput,
): Promise<DirectoryEmployee> => request.patch(`${adminBase()}/employees/${segment(id)}`, input);

export const deleteDirectoryEmployee = async (id: string): Promise<void> => {
  await request.delete(`${adminBase()}/employees/${segment(id)}`);
};

export const inviteDirectoryEmployee = (id: string, email?: string): Promise<DirectoryInvite> =>
  request.post(`${adminBase()}/employees/${segment(id)}/invite`, email != null ? { email } : {});

export const revokeDirectoryInvite = async (id: string): Promise<void> => {
  await request.delete(`${adminBase()}/employees/${segment(id)}`, {
    params: { only_invited: true },
  });
};

export const resetDirectoryPassword = (id: string): Promise<DirectoryTemporaryPassword> =>
  request.post(`${adminBase()}/employees/${segment(id)}/reset-password`, {});

export const getDirectoryDepartments = async (): Promise<DirectoryDepartment[]> => {
  const response: { items: DirectoryDepartment[] } = await request.get(
    `${adminBase()}/departments`,
  );
  return response.items;
};

export const createDirectoryDepartment = (
  input: DirectoryDepartmentCreateInput,
): Promise<DirectoryDepartment> => request.post(`${adminBase()}/departments`, input);

export const updateDirectoryDepartment = (
  id: string,
  input: DirectoryDepartmentInput,
): Promise<DirectoryDepartment> => request.patch(`${adminBase()}/departments/${segment(id)}`, input);

export const deleteDirectoryDepartment = async (id: string): Promise<void> => {
  await request.delete(`${adminBase()}/departments/${segment(id)}`);
};
