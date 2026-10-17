import {
  FilterInput,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@librechat/client';
import type { DirectoryDepartment } from '~/types/directory';
import { useLocalize } from '~/hooks';
import { ALL_FILTER, NO_DEPARTMENT_FILTER } from './filtersState';
import type { EmployeesFiltersState } from './filtersState';

interface EmployeesFiltersProps {
  filters: EmployeesFiltersState;
  onChange: (filters: EmployeesFiltersState) => void;
  departments: DirectoryDepartment[];
}

export default function EmployeesFilters({
  filters,
  onChange,
  departments,
}: EmployeesFiltersProps): JSX.Element {
  const localize = useLocalize();

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1">
        <FilterInput
          inputId="admin-employees-search"
          label={localize('com_admin_employees_search_placeholder')}
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>

      <div className="min-w-[11rem] space-y-1.5">
        <Label htmlFor="admin-employees-filter-department">
          {localize('com_admin_employees_filter_department')}
        </Label>
        <Select
          value={filters.departmentId}
          onValueChange={(value) => onChange({ ...filters, departmentId: value })}
        >
          <SelectTrigger id="admin-employees-filter-department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>{localize('com_admin_employees_filter_all')}</SelectItem>
            <SelectItem value={NO_DEPARTMENT_FILTER}>
              {localize('com_admin_employees_filter_no_department')}
            </SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-[11rem] space-y-1.5">
        <Label htmlFor="admin-employees-filter-status">
          {localize('com_admin_employees_filter_status')}
        </Label>
        <Select
          value={filters.status}
          onValueChange={(value) => onChange({ ...filters, status: value })}
        >
          <SelectTrigger id="admin-employees-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>{localize('com_admin_employees_filter_all')}</SelectItem>
            <SelectItem value="active">
              {localize('com_admin_employees_filter_status_active')}
            </SelectItem>
            <SelectItem value="invited">
              {localize('com_admin_employees_filter_status_invited')}
            </SelectItem>
            <SelectItem value="blocked">
              {localize('com_admin_employees_filter_status_blocked')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
