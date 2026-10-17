import { apiBaseUrl, request } from '~/api';
import type {
  AdminActivityQueryParams,
  AdminActivityResponse,
  AdminAnalyticsQueryParams,
  AdminAnalyticsResponse,
  AdminAnalyticsRow,
  AdminApproveLimitRequestRequest,
  AdminDepartment,
  AdminDepartmentsListResponse,
  AdminFeedbackListResponse,
  AdminFeedbackQueryParams,
  AdminLimitRequest,
  AdminLimitRequestResponse,
  AdminLimitRequestsListResponse,
  AdminModelOption,
  AdminModelsListResponse,
  AdminProviderBalance,
  AdminProviderBalanceResponse,
  AdminSettings,
  AdminSettingsResponse,
  AdminSpendListResponse,
  AdminSpendTranscript,
  AdminSpendTranscriptResponse,
  AdminSpendQueryParams,
  AdminUpdateDepartmentRequest,
  AdminUpdateDepartmentResponse,
  AdminUpdateSettingsRequest,
  AdminUpdateUserRequest,
  AdminUpdateUserResponse,
  AdminUserListItem,
  AdminUserListQuery,
  AdminUsersListResponse,
  LimitRequestStatus,
  MemoryRolePermissions,
} from '~/api';

/**
 * Every list/detail endpoint here wraps its payload in a named envelope
 * (`{ users, total, ... }`, `{ department }`, `{ rows }`, ...) — unwrapped here so every
 * caller works with plain data, never the envelope shape.
 */
const adminBase = (): string => `${apiBaseUrl()}/api/office/admin`;

export type AdminUsersQuery = AdminUserListQuery;

/** Empty filters are omitted rather than sent blank — the server treats them as absent. */
export const getAdminUsers = ({
  limit,
  offset,
  search,
  role,
  departmentId,
}: AdminUsersQuery): Promise<AdminUsersListResponse> =>
  request.get(`${adminBase()}/users`, {
    params: {
      limit,
      offset,
      ...(search != null && search !== '' ? { search } : {}),
      ...(role != null && role !== '' ? { role } : {}),
      ...(departmentId != null && departmentId !== '' ? { departmentId } : {}),
    },
  });

export const getAdminUser = async (id: string): Promise<AdminUserListItem> => {
  const response: AdminUpdateUserResponse = await request.get(
    `${adminBase()}/users/${encodeURIComponent(id)}`,
  );
  return response.user;
};

export const updateAdminUser = (
  id: string,
  payload: AdminUpdateUserRequest,
): Promise<AdminUpdateUserResponse> =>
  request.patch(`${adminBase()}/users/${encodeURIComponent(id)}`, payload);

export const getAdminDepartments = async (): Promise<AdminDepartment[]> => {
  const response: AdminDepartmentsListResponse = await request.get(`${adminBase()}/departments`);
  return response.departments;
};

export const updateAdminDepartment = async (
  id: string,
  payload: AdminUpdateDepartmentRequest,
): Promise<AdminDepartment> => {
  const response: AdminUpdateDepartmentResponse = await request.patch(
    `${adminBase()}/departments/${encodeURIComponent(id)}`,
    payload,
  );
  return response.department;
};

export const getAdminSettings = async (): Promise<AdminSettings> => {
  const response: AdminSettingsResponse = await request.get(`${adminBase()}/settings`);
  return response.settings;
};

export const updateAdminSettings = async (
  payload: AdminUpdateSettingsRequest,
): Promise<AdminSettings> => {
  const response: AdminSettingsResponse = await request.put(`${adminBase()}/settings`, payload);
  return response.settings;
};

export const getAdminLimitRequests = async (
  status?: LimitRequestStatus,
): Promise<AdminLimitRequest[]> => {
  const response: AdminLimitRequestsListResponse = await request.get(
    `${adminBase()}/limit-requests`,
    status ? { params: { status } } : undefined,
  );
  return response.requests;
};

export const approveLimitRequest = async (
  id: string,
  payload: AdminApproveLimitRequestRequest,
): Promise<AdminLimitRequest> => {
  const response: AdminLimitRequestResponse = await request.post(
    `${adminBase()}/limit-requests/${encodeURIComponent(id)}/approve`,
    payload,
  );
  return response.request;
};

export const rejectLimitRequest = async (id: string): Promise<AdminLimitRequest> => {
  const response: AdminLimitRequestResponse = await request.post(
    `${adminBase()}/limit-requests/${encodeURIComponent(id)}/reject`,
  );
  return response.request;
};

export const getAdminSpendLog = (params: AdminSpendQueryParams): Promise<AdminSpendListResponse> =>
  request.get(`${adminBase()}/spend`, { params });

export const getAdminSpendTranscript = async (
  messageId: string,
): Promise<AdminSpendTranscript | null> => {
  const response: AdminSpendTranscriptResponse = await request.get(
    `${adminBase()}/spend/requests/${encodeURIComponent(messageId)}/transcript`,
  );
  return response.transcript;
};

export const getAdminSpendImage = async (messageId: string, fileId: string): Promise<Blob> => {
  const response = await request.getResponse(
    `${adminBase()}/spend/requests/${encodeURIComponent(messageId)}/images/${encodeURIComponent(fileId)}`,
    { responseType: 'blob' },
  );
  return response.data as Blob;
};

export const getAdminAnalytics = async (
  params: AdminAnalyticsQueryParams,
): Promise<AdminAnalyticsRow[]> => {
  const response: AdminAnalyticsResponse = await request.get(`${adminBase()}/analytics`, {
    params,
  });
  return response.rows;
};

export const getAdminProviderBalance = async (): Promise<AdminProviderBalance> => {
  const response: AdminProviderBalanceResponse = await request.get(
    `${adminBase()}/provider-balance`,
  );
  return response.balance;
};

export const getAdminModels = async (): Promise<AdminModelOption[]> => {
  const response: AdminModelsListResponse = await request.get(`${adminBase()}/models`);
  return response.models;
};

export const getAdminActivity = (
  params: AdminActivityQueryParams,
): Promise<AdminActivityResponse> => request.get(`${adminBase()}/analytics/activity`, { params });

export const getAdminFeedback = (
  params: AdminFeedbackQueryParams,
): Promise<AdminFeedbackListResponse> => request.get(`${adminBase()}/feedback`, { params });

/**
 * Полномочия ролей живут не под `/api/office/admin`, а в самом LibreChat: это его
 * механизм ролей, а не отдельная сущность офиса. Ручки уже существуют и закрыты
 * полномочием `manage:roles`, так что своей серверной обёртки здесь не нужно.
 */
const rolesBase = (): string => `${apiBaseUrl()}/api/roles`;

export const getRoleMemoryPermissions = async (
  roleName: string,
): Promise<MemoryRolePermissions> => {
  const role: { permissions?: { MEMORIES?: Partial<MemoryRolePermissions> } } = await request.get(
    `${rolesBase()}/${encodeURIComponent(roleName)}`,
  );
  const permissions = role.permissions?.MEMORIES ?? {};
  /** Отсутствующее полномочие — «выключено»: роль могла быть заведена до того, как
   *  память вообще появилась в конфиге, и тогда секции MEMORIES у неё просто нет. */
  return {
    USE: permissions.USE === true,
    CREATE: permissions.CREATE === true,
    UPDATE: permissions.UPDATE === true,
    READ: permissions.READ === true,
    OPT_OUT: permissions.OPT_OUT === true,
  };
};

export const updateRoleMemoryPermissions = (
  roleName: string,
  updates: MemoryRolePermissions,
): Promise<unknown> =>
  request.put(`${rolesBase()}/${encodeURIComponent(roleName)}/memories`, updates);
