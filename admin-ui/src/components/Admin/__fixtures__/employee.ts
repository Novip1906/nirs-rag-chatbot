import type { DirectoryEmployee } from '~/types/directory';

const NEVER_ACTIVATED = new Set(['invited', 'invite_expired']);

export function directoryEmployee(overrides: Partial<DirectoryEmployee> = {}): DirectoryEmployee {
  const status = overrides.status ?? 'active';
  return {
    id: 'emp-1',
    sub: 'sub-1',
    email: 'ivan@example.test',
    first_name: 'Ivan',
    last_name: 'Petrov',
    position: 'CTO',
    department_id: 'dept-1',
    is_admin: false,
    is_head: false,
    blocked: false,
    status,
    avatar_url: null,
    invited_at: null,
    invite_expires_at: null,
    invited_by: null,
    activated_at: NEVER_ACTIVATED.has(status) ? null : '2026-09-01T10:00:00Z',
    name_confirmed: true,
    created_at: '',
    updated_at: '',
    deleted_at: null,
    ...overrides,
  };
}
