export type DirectoryEmployeeStatus = 'invited' | 'invite_expired' | 'active' | 'blocked';

export interface DirectoryEmployee {
  id: string;
  sub: string;
  email: string;
  first_name: string;
  last_name: string;
  position: string;
  department_id: string | null;
  is_admin: boolean;
  is_head: boolean;
  blocked: boolean;
  status: DirectoryEmployeeStatus;
  avatar_url: string | null;
  invited_at: string | null;
  invite_expires_at: string | null;
  invited_by: string | null;
  activated_at: string | null;
  name_confirmed: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DirectoryInvite {
  employee: DirectoryEmployee;
  invite_link: string;
  email_sent: boolean;
}

export function isPendingInvite(employee: Pick<DirectoryEmployee, 'activated_at'>): boolean {
  return employee.activated_at == null;
}

export interface DirectoryDepartment {
  id: string;
  name: string;
  description: string;
  employees_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DirectoryEmployeeInput {
  email?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  department_id?: string | null;
  is_admin?: boolean;
  is_head?: boolean;
  blocked?: boolean;
}

export interface DirectoryEmployeeCreateInput {
  email: string;
  first_name: string;
  last_name?: string;
  position: string;
  department_id: string | null;
}

export interface DirectoryDepartmentInput {
  name?: string;
  description?: string;
}

export interface DirectoryDepartmentCreateInput {
  name: string;
  description: string;
}

export interface DirectoryError {
  error_code: string;
  message: string;
  fields?: Record<string, string>;
}

export interface DirectoryMe {
  employee: DirectoryEmployee | null;
  is_admin: boolean;
}

export interface DirectoryEmployeesQuery {
  q?: string;
  department_id?: string;
  status?: 'active' | 'blocked' | 'invited';
  page: number;
  page_size: number;
}

export interface DirectoryEmployeesResponse {
  items: DirectoryEmployee[];
  total: number;
}

export interface DirectoryTemporaryPassword {
  temporary_password: string;
}
