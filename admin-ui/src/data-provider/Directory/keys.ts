import type { QueryKey } from '@tanstack/react-query';
import type { DirectoryEmployeesQuery } from '../../types/directory';

export const directoryKeys = {
  me: ['directory', 'me'] as QueryKey,
  employeesRoot: ['directory', 'employees'] as QueryKey,
  employees: (query: DirectoryEmployeesQuery): QueryKey => ['directory', 'employees', query],
  employee: (id: string | null | undefined): QueryKey => ['directory', 'employee', id],
  departments: ['directory', 'departments'] as QueryKey,
};
