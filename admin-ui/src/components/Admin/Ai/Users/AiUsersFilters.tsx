import {
  FilterInput,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import { SystemRoles, ADMIN_NO_DEPARTMENT } from '~/api';
import type { AdminDepartment } from '~/api';
import { useRoleLabel } from '~/components/Admin/utils/roleLabels';
import { useLocalize } from '~/hooks';

export const ALL_FILTER = 'all';

export interface AiUsersFiltersState {
  search: string;
  departmentId: string;
  role: string;
}

export const EMPTY_FILTERS: AiUsersFiltersState = {
  search: '',
  departmentId: ALL_FILTER,
  role: ALL_FILTER,
};

export function toAiUsersQueryFilters(filters: AiUsersFiltersState): {
  search?: string;
  departmentId?: string;
  role?: string;
} {
  return {
    ...(filters.search !== '' ? { search: filters.search } : {}),
    ...(filters.departmentId !== ALL_FILTER ? { departmentId: filters.departmentId } : {}),
    ...(filters.role !== ALL_FILTER ? { role: filters.role } : {}),
  };
}

interface AiUsersFiltersProps {
  filters: AiUsersFiltersState;
  onChange: (filters: AiUsersFiltersState) => void;
  departments: AdminDepartment[];
}

const ROLE_OPTIONS: string[] = [
  SystemRoles.OWNER,
  SystemRoles.ADMIN,
  SystemRoles.HEAD,
  SystemRoles.USER,
];

export default function AiUsersFilters({
  filters,
  onChange,
  departments,
}: AiUsersFiltersProps): JSX.Element {
  const localize = useLocalize();
  const roleLabel = useRoleLabel();

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1">
        <FilterInput
          inputId="admin-users-search"
          label={localize('com_admin_users_search_placeholder')}
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>

      {departments.length > 0 && (
        <div className="min-w-[11rem] space-y-1.5">
          <Label htmlFor="admin-users-filter-department">
            {localize('com_admin_users_filter_department')}
          </Label>
          <Select
            value={filters.departmentId}
            onValueChange={(value) => onChange({ ...filters, departmentId: value })}
          >
            <SelectTrigger id="admin-users-filter-department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>{localize('com_admin_users_filter_all')}</SelectItem>
              <SelectItem value={ADMIN_NO_DEPARTMENT}>
                {localize('com_admin_users_filter_no_department')}
              </SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="min-w-[11rem] space-y-1.5">
        <Label htmlFor="admin-users-filter-role">{localize('com_admin_users_filter_role')}</Label>
        <Select
          value={filters.role}
          onValueChange={(value) => onChange({ ...filters, role: value })}
        >
          <SelectTrigger id="admin-users-filter-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>{localize('com_admin_users_filter_all')}</SelectItem>
            {ROLE_OPTIONS.map((role) => (
              <SelectItem key={role} value={role}>
                {roleLabel(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
