import type { DirectoryEmployeesQuery } from '~/types/directory';

export const ALL_FILTER = 'all';
export const NO_DEPARTMENT_FILTER = 'none';

export interface EmployeesFiltersState {
  search: string;
  departmentId: string;
  status: string;
}

export const EMPTY_FILTERS: EmployeesFiltersState = {
  search: '',
  departmentId: ALL_FILTER,
  status: ALL_FILTER,
};

export function toEmployeesQueryFilters(
  filters: EmployeesFiltersState,
): Pick<DirectoryEmployeesQuery, 'q' | 'department_id' | 'status'> {
  return {
    ...(filters.search !== '' ? { q: filters.search } : {}),
    ...(filters.departmentId !== ALL_FILTER ? { department_id: filters.departmentId } : {}),
    ...(filters.status !== ALL_FILTER
      ? { status: filters.status as DirectoryEmployeesQuery['status'] }
      : {}),
  };
}
