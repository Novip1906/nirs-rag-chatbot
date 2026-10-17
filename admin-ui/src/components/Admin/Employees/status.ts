import type { TranslationKeys } from '~/hooks/useLocalize';
import type { DirectoryEmployee } from '~/types/directory';

export interface StatusTag {
  labelKey: TranslationKeys;
  variant: 'info' | 'warning' | 'success' | 'error';
}

const BLOCKED: StatusTag = { labelKey: 'com_admin_employees_status_blocked', variant: 'error' };
const ACTIVE: StatusTag = { labelKey: 'com_admin_employees_status_active', variant: 'success' };

export function statusTag(employee: Pick<DirectoryEmployee, 'status' | 'blocked'>): StatusTag {
  switch (employee.status) {
    case 'invited':
      return { labelKey: 'com_admin_employees_status_invited', variant: 'info' };
    case 'invite_expired':
      return { labelKey: 'com_admin_employees_status_invite_expired', variant: 'warning' };
    case 'active':
      return ACTIVE;
    case 'blocked':
      return BLOCKED;
    default:
      return employee.blocked ? BLOCKED : ACTIVE;
  }
}
