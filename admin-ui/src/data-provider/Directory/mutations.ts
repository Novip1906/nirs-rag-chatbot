import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query';
import type {
  DirectoryDepartment,
  DirectoryDepartmentCreateInput,
  DirectoryDepartmentInput,
  DirectoryEmployee,
  DirectoryEmployeeCreateInput,
  DirectoryEmployeeInput,
  DirectoryInvite,
  DirectoryTemporaryPassword,
} from '../../types/directory';
import {
  createDirectoryDepartment,
  createDirectoryEmployee,
  deleteDirectoryDepartment,
  deleteDirectoryEmployee,
  inviteDirectoryEmployee,
  resetDirectoryPassword,
  revokeDirectoryInvite,
  updateDirectoryDepartment,
  updateDirectoryEmployee,
} from './request';
import { adminKeys } from '../Admin/keys';
import { directoryKeys } from './keys';

export interface UpdateDirectoryEmployeeVariables {
  id: string;
  input: DirectoryEmployeeInput;
}

export interface InviteDirectoryEmployeeVariables {
  id: string;
  email?: string;
}

export interface UpdateDirectoryDepartmentVariables {
  id: string;
  input: DirectoryDepartmentInput;
}

const invalidateAiData = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries(adminKeys.usersRoot);
  void queryClient.invalidateQueries(adminKeys.userRoot);
  void queryClient.invalidateQueries(adminKeys.departments);
};

export const useCreateDirectoryEmployeeMutation = (
  config?: UseMutationOptions<DirectoryInvite, unknown, DirectoryEmployeeCreateInput>,
): UseMutationResult<DirectoryInvite, unknown, DirectoryEmployeeCreateInput> => {
  const queryClient = useQueryClient();
  return useMutation<DirectoryInvite, unknown, DirectoryEmployeeCreateInput>(
    createDirectoryEmployee,
    {
      ...config,
      onSuccess: (...args) => {
        void queryClient.invalidateQueries(directoryKeys.employeesRoot);
        void queryClient.invalidateQueries(directoryKeys.departments);
        invalidateAiData(queryClient);
        return config?.onSuccess?.(...args);
      },
    },
  );
};

export const useUpdateDirectoryEmployeeMutation = (
  config?: UseMutationOptions<DirectoryEmployee, unknown, UpdateDirectoryEmployeeVariables>,
): UseMutationResult<DirectoryEmployee, unknown, UpdateDirectoryEmployeeVariables> => {
  const queryClient = useQueryClient();
  return useMutation<DirectoryEmployee, unknown, UpdateDirectoryEmployeeVariables>(
    ({ id, input }) => updateDirectoryEmployee(id, input),
    {
      ...config,
      onSuccess: (employee, variables, context) => {
        queryClient.setQueryData(directoryKeys.employee(variables.id), employee);
        void queryClient.invalidateQueries(directoryKeys.employeesRoot);
        void queryClient.invalidateQueries(directoryKeys.departments);
        void queryClient.invalidateQueries(directoryKeys.me);
        invalidateAiData(queryClient);
        return config?.onSuccess?.(employee, variables, context);
      },
    },
  );
};

export const useDeleteDirectoryEmployeeMutation = (
  config?: UseMutationOptions<void, unknown, string>,
): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>(deleteDirectoryEmployee, {
    ...config,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries(directoryKeys.employeesRoot);
      void queryClient.invalidateQueries(directoryKeys.departments);
      invalidateAiData(queryClient);
      return config?.onSuccess?.(...args);
    },
  });
};

export const useInviteDirectoryEmployeeMutation = (
  config?: UseMutationOptions<DirectoryInvite, unknown, InviteDirectoryEmployeeVariables>,
): UseMutationResult<DirectoryInvite, unknown, InviteDirectoryEmployeeVariables> => {
  const queryClient = useQueryClient();
  return useMutation<DirectoryInvite, unknown, InviteDirectoryEmployeeVariables>(
    ({ id, email }) => inviteDirectoryEmployee(id, email),
    {
      ...config,
      onSuccess: (data, variables, context) => {
        queryClient.setQueryData(directoryKeys.employee(variables.id), data.employee);
        return config?.onSuccess?.(data, variables, context);
      },
      onSettled: (data, error, variables, context) => {
        void queryClient.invalidateQueries(directoryKeys.employee(variables.id));
        void queryClient.invalidateQueries(directoryKeys.employeesRoot);
        void queryClient.invalidateQueries(directoryKeys.departments);
        return config?.onSettled?.(data, error, variables, context);
      },
    },
  );
};

export const useRevokeDirectoryInviteMutation = (
  config?: UseMutationOptions<void, unknown, string>,
): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>(revokeDirectoryInvite, {
    ...config,
    onSettled: (data, error, variables, context) => {
      void queryClient.invalidateQueries(directoryKeys.employee(variables));
      void queryClient.invalidateQueries(directoryKeys.employeesRoot);
      void queryClient.invalidateQueries(directoryKeys.departments);
      invalidateAiData(queryClient);
      return config?.onSettled?.(data, error, variables, context);
    },
  });
};

export const useResetDirectoryPasswordMutation = (
  config?: UseMutationOptions<DirectoryTemporaryPassword, unknown, string>,
): UseMutationResult<DirectoryTemporaryPassword, unknown, string> =>
  useMutation<DirectoryTemporaryPassword, unknown, string>(resetDirectoryPassword, config);

export const useCreateDirectoryDepartmentMutation = (
  config?: UseMutationOptions<DirectoryDepartment, unknown, DirectoryDepartmentCreateInput>,
): UseMutationResult<DirectoryDepartment, unknown, DirectoryDepartmentCreateInput> => {
  const queryClient = useQueryClient();
  return useMutation<DirectoryDepartment, unknown, DirectoryDepartmentCreateInput>(
    createDirectoryDepartment,
    {
      ...config,
      onSuccess: (...args) => {
        void queryClient.invalidateQueries(directoryKeys.departments);
        invalidateAiData(queryClient);
        return config?.onSuccess?.(...args);
      },
    },
  );
};

export const useUpdateDirectoryDepartmentMutation = (
  config?: UseMutationOptions<DirectoryDepartment, unknown, UpdateDirectoryDepartmentVariables>,
): UseMutationResult<DirectoryDepartment, unknown, UpdateDirectoryDepartmentVariables> => {
  const queryClient = useQueryClient();
  return useMutation<DirectoryDepartment, unknown, UpdateDirectoryDepartmentVariables>(
    ({ id, input }) => updateDirectoryDepartment(id, input),
    {
      ...config,
      onSuccess: (...args) => {
        void queryClient.invalidateQueries(directoryKeys.departments);
        invalidateAiData(queryClient);
        return config?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteDirectoryDepartmentMutation = (
  config?: UseMutationOptions<void, unknown, string>,
): UseMutationResult<void, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>(deleteDirectoryDepartment, {
    ...config,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries(directoryKeys.departments);
      invalidateAiData(queryClient);
      return config?.onSuccess?.(...args);
    },
  });
};
