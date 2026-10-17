import { useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  AdminApproveLimitRequestRequest,
  AdminDepartment,
  AdminLimitRequest,
  AdminSettings,
  AdminUpdateDepartmentRequest,
  AdminUpdateSettingsRequest,
  AdminUpdateUserRequest,
  AdminUpdateUserResponse,
  MemoryRolePermissions,
} from '~/api';
import {
  approveLimitRequest,
  rejectLimitRequest,
  updateAdminDepartment,
  updateAdminSettings,
  updateAdminUser,
  updateRoleMemoryPermissions,
} from './request';
import { getAdminErrorMessage } from '~/components/Admin/utils/format';
import { useLocalize } from '~/hooks';
import { adminKeys } from './keys';

export const useUpdateAdminUserMutation = (): UseMutationResult<
  AdminUpdateUserResponse,
  unknown,
  { id: string; payload: AdminUpdateUserRequest }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id, payload }) => updateAdminUser(id, payload), {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries(adminKeys.usersRoot);
      queryClient.invalidateQueries(adminKeys.user(variables.id), { exact: true });
      showToast({ message: localize('com_admin_toast_user_updated'), status: 'success' });
    },
  });
};

export const useUpdateAdminDepartmentMutation = (): UseMutationResult<
  AdminDepartment,
  unknown,
  { id: string; payload: AdminUpdateDepartmentRequest }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id, payload }) => updateAdminDepartment(id, payload), {
    onSuccess: () => {
      queryClient.invalidateQueries(adminKeys.departments);
      queryClient.invalidateQueries(adminKeys.usersRoot);
      /** Department limits/models are inherited by its members — any of them could
       *  have their detail page open right now, showing stale inherited values. */
      queryClient.invalidateQueries(adminKeys.userRoot);
      showToast({ message: localize('com_admin_toast_department_updated'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useUpdateAdminSettingsMutation = (): UseMutationResult<
  AdminSettings,
  unknown,
  AdminUpdateSettingsRequest
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation((payload: AdminUpdateSettingsRequest) => updateAdminSettings(payload), {
    onSuccess: () => {
      queryClient.invalidateQueries(adminKeys.settings);
      queryClient.invalidateQueries(adminKeys.usersRoot);
      /** Global defaults are the fallback for anyone without a personal or
       *  department override — their detail pages show stale inherited values too. */
      queryClient.invalidateQueries(adminKeys.userRoot);
      showToast({ message: localize('com_admin_toast_settings_updated'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useApproveLimitRequestMutation = (): UseMutationResult<
  AdminLimitRequest,
  unknown,
  { id: string; payload: AdminApproveLimitRequestRequest }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(({ id, payload }) => approveLimitRequest(id, payload), {
    onSuccess: () => {
      queryClient.invalidateQueries(adminKeys.limitRequests());
      queryClient.invalidateQueries(adminKeys.usersRoot);
      queryClient.invalidateQueries(adminKeys.userRoot);
      showToast({ message: localize('com_admin_toast_request_approved'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useRejectLimitRequestMutation = (): UseMutationResult<
  AdminLimitRequest,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation((id: string) => rejectLimitRequest(id), {
    onSuccess: () => {
      queryClient.invalidateQueries(adminKeys.limitRequests());
      showToast({ message: localize('com_admin_toast_request_rejected'), status: 'success' });
    },
    onError: (error) => {
      showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
    },
  });
};

export const useUpdateRoleMemoryPermissionsMutation = (): UseMutationResult<
  unknown,
  unknown,
  { roleName: string; permissions: MemoryRolePermissions }
> => {
  const queryClient = useQueryClient();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  return useMutation(
    ({ roleName, permissions }) => updateRoleMemoryPermissions(roleName, permissions),
    {
      onSuccess: (_data, { roleName }) => {
        queryClient.invalidateQueries(adminKeys.memoryPermissions(roleName));
        showToast({ message: localize('com_admin_toast_memory_updated'), status: 'success' });
      },
      onError: (error) => {
        showToast({ message: getAdminErrorMessage(error, localize), status: 'error' });
      },
    },
  );
};
