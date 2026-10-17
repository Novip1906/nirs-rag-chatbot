import { createElement } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AdminDepartment,
  AdminLimitRequest,
  AdminUserListItem,
} from '~/api';
import {
  useApproveLimitRequestMutation,
  useUpdateAdminDepartmentMutation,
  useUpdateAdminSettingsMutation,
  useUpdateAdminUserMutation,
} from '../mutations';
import { adminKeys } from '../keys';

const mockUpdateAdminUser = jest.fn();
const mockApproveLimitRequest = jest.fn();
const mockUpdateAdminDepartment = jest.fn();
const mockUpdateAdminSettings = jest.fn();
const mockRejectLimitRequest = jest.fn();

jest.mock('../request', () => ({
  updateAdminUser: (...args: unknown[]) => mockUpdateAdminUser(...args),
  approveLimitRequest: (...args: unknown[]) => mockApproveLimitRequest(...args),
  updateAdminDepartment: (...args: unknown[]) => mockUpdateAdminDepartment(...args),
  updateAdminSettings: (...args: unknown[]) => mockUpdateAdminSettings(...args),
  rejectLimitRequest: (...args: unknown[]) => mockRejectLimitRequest(...args),
}));

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };

const USER: AdminUserListItem = {
  id: 'user-1',
  employeeId: null,
  openidId: null,
  name: 'Ivan Ivanov',
  email: 'ivan@example.com',
  position: '',
  role: 'USER',
  departmentId: null,
  departmentName: null,
  limits: { dailyCostUsd: null },
  limitsOverride: null,
  allowedModels: [],
  allowedModelsOverride: null,
  defaultModel: null,
  defaultModelOverride: null,
  blocked: false,
  canUploadKnowledge: false,
  spendToday: { costUsd: 0, requests: 0 },
  spendMonth: { costUsd: 0, requests: 0 },
};

const LIMIT_REQUEST: AdminLimitRequest = {
  id: 'req-1',
  userId: 'user-1',
  userName: 'Ivan Ivanov',
  userEmail: 'ivan@example.com',
  window: 'daily',
  status: 'approved',
  limitBefore: 500,
  limitAfter: 1200,
  history: [],
  resolvedBy: 'admin-1',
  resolvedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DEPARTMENT: AdminDepartment = {
  id: 'dept-1',
  name: 'Legal',
  systemPrompt: '',
  allowedModels: [],
  defaultModel: null,
  defaultLimits: { dailyCostUsd: null },
  directoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeQueryClient() {
  return new QueryClient({
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('Admin mutations — cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useUpdateAdminUserMutation invalidates the users list and the single user detail query', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUpdateAdminUser.mockResolvedValue({ user: USER });
    const { result } = renderHook(() => useUpdateAdminUserMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'user-1', payload: {} });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(adminKeys.usersRoot);
    expect(invalidateQueries).toHaveBeenCalledWith(adminKeys.user('user-1'), { exact: true });
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_admin_toast_user_updated',
      status: 'success',
    });
    queryClient.clear();
  });

  /**
   * Regression: an approved limit-increase request changes one user's limits. The detail
   * page is cached under the employee id while the request only carries the AI user id, so
   * the whole detail prefix is invalidated.
   */
  it('useApproveLimitRequestMutation invalidates the user-detail prefix', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockApproveLimitRequest.mockResolvedValue(LIMIT_REQUEST);
    const { result } = renderHook(() => useApproveLimitRequestMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'req-1', payload: { limits: {} } });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(adminKeys.userRoot);
    queryClient.clear();
  });

  it('useUpdateAdminDepartmentMutation invalidates the shared user-detail prefix, since members inherit its limits/models', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUpdateAdminDepartment.mockResolvedValue(DEPARTMENT);
    const { result } = renderHook(() => useUpdateAdminDepartmentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'dept-1', payload: {} });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(adminKeys.userRoot);
    queryClient.clear();
  });

  it('useUpdateAdminDepartmentMutation shows the server text on a 502', async () => {
    const queryClient = makeQueryClient();
    mockUpdateAdminDepartment.mockRejectedValue({
      isAxiosError: true,
      response: { status: 502, data: { error: 'upstream timeout' } },
    });
    const { result } = renderHook(() => useUpdateAdminDepartmentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'dept-1', payload: { systemPrompt: 'Legal 2' } }).catch(() => {});
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'upstream timeout',
      status: 'error',
    });
    queryClient.clear();
  });

  it('useUpdateAdminSettingsMutation invalidates the shared user-detail prefix, since global defaults ripple into users without a personal override', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUpdateAdminSettings.mockResolvedValue({
      systemPrompt: '',
      allowedModels: [],
      defaultLimits: { dailyCostUsd: null },
    });
    const { result } = renderHook(() => useUpdateAdminSettingsMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({});
    });

    expect(invalidateQueries).toHaveBeenCalledWith(adminKeys.userRoot);
    queryClient.clear();
  });
});

describe('Admin mutations — visible errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useUpdateAdminUserMutation не показывает тост при ошибке — карточка сама покажет локализованный текст', async () => {
    const queryClient = makeQueryClient();
    mockUpdateAdminUser.mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: 'defaultModel is required when allowedModels is not empty' } },
    });
    const { result } = renderHook(() => useUpdateAdminUserMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'user-1', payload: {} }).catch(() => {});
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    queryClient.clear();
  });
});
