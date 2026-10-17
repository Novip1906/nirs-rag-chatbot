import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type {
  AdminActivityQueryParams,
  AdminActivityResponse,
  AdminAnalyticsQueryParams,
  AdminAnalyticsRow,
  AdminDepartment,
  AdminFeedbackListResponse,
  AdminFeedbackQueryParams,
  AdminLimitRequest,
  AdminModelOption,
  AdminProviderBalance,
  AdminSettings,
  AdminSpendListResponse,
  AdminSpendQueryParams,
  AdminSpendTranscript,
  AdminUserListItem,
  AdminUsersListResponse,
  LimitRequestStatus,
  MemoryRolePermissions,
} from '~/api';
import {
  getAdminActivity,
  getAdminAnalytics,
  getAdminDepartments,
  getAdminFeedback,
  getAdminLimitRequests,
  getAdminModels,
  getAdminProviderBalance,
  getAdminSettings,
  getAdminSpendLog,
  getAdminSpendTranscript,
  getAdminSpendImage,
  getAdminUser,
  getAdminUsers,
  getRoleMemoryPermissions,
} from './request';
import type { AdminUsersQuery } from './request';
import { adminKeys } from './keys';
import { retrySkipping4xx } from '../retry';

const PROVIDER_BALANCE_STALE_TIME_MS = 60_000;

export const useAdminUsersQuery = (
  query: AdminUsersQuery,
  config?: UseQueryOptions<AdminUsersListResponse>,
): QueryObserverResult<AdminUsersListResponse> =>
  useQuery<AdminUsersListResponse>(adminKeys.users(query), () => getAdminUsers(query), {
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    ...config,
  });

export const useAdminUserQuery = (
  id: string | null | undefined,
  config?: UseQueryOptions<AdminUserListItem>,
): QueryObserverResult<AdminUserListItem> =>
  useQuery<AdminUserListItem>(adminKeys.user(id), () => getAdminUser(id ?? ''), {
    refetchOnWindowFocus: false,
    enabled: id != null && id !== '',
    retry: retrySkipping4xx,
    ...config,
  });

export const useAdminDepartmentsQuery = (
  config?: UseQueryOptions<AdminDepartment[]>,
): QueryObserverResult<AdminDepartment[]> =>
  useQuery<AdminDepartment[]>(adminKeys.departments, getAdminDepartments, {
    refetchOnWindowFocus: false,
    retry: retrySkipping4xx,
    ...config,
  });

export const useAdminSettingsQuery = (
  config?: UseQueryOptions<AdminSettings>,
): QueryObserverResult<AdminSettings> =>
  useQuery<AdminSettings>(adminKeys.settings, getAdminSettings, {
    refetchOnWindowFocus: false,
    ...config,
  });

export const useAdminLimitRequestsQuery = (
  status?: LimitRequestStatus,
  config?: UseQueryOptions<AdminLimitRequest[]>,
): QueryObserverResult<AdminLimitRequest[]> =>
  useQuery<AdminLimitRequest[]>(
    adminKeys.limitRequests(status),
    () => getAdminLimitRequests(status),
    { refetchOnWindowFocus: false, ...config },
  );

export const useAdminSpendLogQuery = (
  params: AdminSpendQueryParams,
  config?: UseQueryOptions<AdminSpendListResponse>,
): QueryObserverResult<AdminSpendListResponse> =>
  useQuery<AdminSpendListResponse>(adminKeys.spend(params), () => getAdminSpendLog(params), {
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    ...config,
  });

/**
 * Тексты переписки грузятся отдельно и только когда администратор раскрыл строку —
 * список расходов сам по себе их не несёт.
 */
export const useAdminSpendTranscriptQuery = (
  messageId: string | null,
  config?: UseQueryOptions<AdminSpendTranscript | null>,
): QueryObserverResult<AdminSpendTranscript | null> =>
  useQuery<AdminSpendTranscript | null>(
    adminKeys.spendTranscript(messageId ?? ''),
    () => getAdminSpendTranscript(messageId ?? ''),
    {
      enabled: messageId != null && messageId !== '',
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      ...config,
    },
  );

export const useAdminSpendImageQuery = (
  messageId: string,
  fileId: string,
): QueryObserverResult<Blob> =>
  useQuery<Blob>(
    adminKeys.spendImage(messageId, fileId),
    () => getAdminSpendImage(messageId, fileId),
    {
      enabled: messageId !== '' && fileId !== '',
      refetchOnWindowFocus: false,
      staleTime: 30 * 60 * 1000,
      retry: retrySkipping4xx,
    },
  );

export const useAdminAnalyticsQuery = (
  params: AdminAnalyticsQueryParams,
  config?: UseQueryOptions<AdminAnalyticsRow[]>,
): QueryObserverResult<AdminAnalyticsRow[]> =>
  useQuery<AdminAnalyticsRow[]>(adminKeys.analytics(params), () => getAdminAnalytics(params), {
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    ...config,
  });

export const useAdminProviderBalanceQuery = (
  config?: UseQueryOptions<AdminProviderBalance>,
): QueryObserverResult<AdminProviderBalance> =>
  useQuery<AdminProviderBalance>(adminKeys.providerBalance, getAdminProviderBalance, {
    refetchOnWindowFocus: false,
    staleTime: PROVIDER_BALANCE_STALE_TIME_MS,
    ...config,
  });

export const useAdminModelsQuery = (
  config?: UseQueryOptions<AdminModelOption[]>,
): QueryObserverResult<AdminModelOption[]> =>
  useQuery<AdminModelOption[]>(adminKeys.models, getAdminModels, {
    refetchOnWindowFocus: false,
    retry: retrySkipping4xx,
    ...config,
  });

export const useAdminActivityQuery = (
  params: AdminActivityQueryParams,
  config?: UseQueryOptions<AdminActivityResponse>,
): QueryObserverResult<AdminActivityResponse> =>
  useQuery<AdminActivityResponse>(adminKeys.activity(params), () => getAdminActivity(params), {
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    ...config,
  });

export const useAdminFeedbackQuery = (
  params: AdminFeedbackQueryParams,
  config?: UseQueryOptions<AdminFeedbackListResponse>,
): QueryObserverResult<AdminFeedbackListResponse> =>
  useQuery<AdminFeedbackListResponse>(adminKeys.feedback(params), () => getAdminFeedback(params), {
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    ...config,
  });

export const useRoleMemoryPermissionsQuery = (
  roleName: string,
  config?: UseQueryOptions<MemoryRolePermissions>,
): QueryObserverResult<MemoryRolePermissions> =>
  useQuery<MemoryRolePermissions>(
    adminKeys.memoryPermissions(roleName),
    () => getRoleMemoryPermissions(roleName),
    {
      refetchOnWindowFocus: false,
      ...config,
    },
  );
