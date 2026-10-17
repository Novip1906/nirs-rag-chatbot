import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type {
  DirectoryDepartment,
  DirectoryEmployee,
  DirectoryEmployeesQuery,
  DirectoryEmployeesResponse,
  DirectoryMe,
} from '../../types/directory';
import {
  getDirectoryDepartments,
  getDirectoryEmployee,
  getDirectoryEmployees,
  getDirectoryMe,
} from './request';
import { directoryKeys } from './keys';
import { retrySkipping4xx } from '../retry';

export const useDirectoryMeQuery = (
  config?: UseQueryOptions<DirectoryMe>,
): QueryObserverResult<DirectoryMe> =>
  useQuery<DirectoryMe>(directoryKeys.me, getDirectoryMe, {
    refetchOnWindowFocus: false,
    retry: retrySkipping4xx,
    ...config,
  });

export const useDirectoryEmployeesQuery = (
  params: DirectoryEmployeesQuery,
  config?: UseQueryOptions<DirectoryEmployeesResponse>,
): QueryObserverResult<DirectoryEmployeesResponse> =>
  useQuery<DirectoryEmployeesResponse>(
    directoryKeys.employees(params),
    () => getDirectoryEmployees(params),
    {
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      retry: retrySkipping4xx,
      ...config,
    },
  );

export const useDirectoryEmployeeQuery = (
  id: string | null | undefined,
  config?: UseQueryOptions<DirectoryEmployee>,
): QueryObserverResult<DirectoryEmployee> =>
  useQuery<DirectoryEmployee>(
    directoryKeys.employee(id),
    () => getDirectoryEmployee(id as string),
    {
      enabled: id != null && id !== '',
      refetchOnWindowFocus: false,
      retry: retrySkipping4xx,
      ...config,
    },
  );

export const useDirectoryDepartmentsQuery = (
  config?: UseQueryOptions<DirectoryDepartment[]>,
): QueryObserverResult<DirectoryDepartment[]> =>
  useQuery<DirectoryDepartment[]>(directoryKeys.departments, getDirectoryDepartments, {
    refetchOnWindowFocus: false,
    retry: retrySkipping4xx,
    ...config,
  });
