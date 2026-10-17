import { request as httpRequest } from '~/api';
import type {
  AdminActivityResponse,
  AdminAnalyticsResponse,
  AdminDepartment,
  AdminDepartmentsListResponse,
  AdminFeedbackListResponse,
  AdminLimitRequest,
  AdminLimitRequestResponse,
  AdminLimitRequestsListResponse,
  AdminModelOption,
  AdminModelsListResponse,
  AdminSettingsResponse,
  AdminSpendListResponse,
  AdminUpdateDepartmentResponse,
  AdminUpdateUserResponse,
  AdminUserListItem,
  AdminUsersListResponse,
} from '~/api';
import {
  approveLimitRequest,
  getAdminActivity,
  getAdminAnalytics,
  getAdminDepartments,
  getAdminFeedback,
  getAdminLimitRequests,
  getAdminModels,
  getAdminSettings,
  getAdminSpendLog,
  getAdminUser,
  getAdminUsers,
  rejectLimitRequest,
  updateAdminDepartment,
  updateAdminUser,
} from '../request';

/**
 * Every fixture here is typed against the response shapes agent B actually declared in
 * `packages/data-provider/src/types/admin.ts` — not a shape this file invents. If that
 * contract ever drifts (a field renamed, an envelope added or dropped), these fixtures
 * fail to *compile*, and the unwrap assertions below fail to *run* — a unit test built
 * against a made-up shape can't catch either kind of drift; this one is built to.
 */
jest.mock('~/api', () => ({
  ...jest.requireActual('~/api'),
  request: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedRequest = httpRequest as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
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
  allowedModels: ['gpt-4o'],
  allowedModelsOverride: null,
  defaultModel: null,
  defaultModelOverride: null,
  blocked: false,
  canUploadKnowledge: false,
  spendToday: { costUsd: 0, requests: 0 },
  spendMonth: { costUsd: 0, requests: 0 },
};

const DEPARTMENT: AdminDepartment = {
  id: 'dept-1',
  name: 'Legal',
  description: '',
  systemPrompt: '',
  allowedModels: [],
  defaultModel: null,
  defaultLimits: { dailyCostUsd: null },
  directoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const LIMIT_REQUEST: AdminLimitRequest = {
  id: 'req-1',
  userId: 'user-1',
  userName: 'Ivan Ivanov',
  userEmail: 'ivan@example.com',
  window: 'daily',
  status: 'pending',
  limitBefore: 500,
  limitAfter: null,
  history: [],
  resolvedBy: null,
  resolvedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Admin request.ts — envelope unwrapping', () => {
  it('keeps the users-list envelope intact (pagination metadata lives alongside the array)', async () => {
    const response: AdminUsersListResponse = { users: [USER], total: 1, limit: 50, offset: 0 };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminUsers({ limit: 50, offset: 0 });

    expect(result).toEqual(response);
    expect(result.users).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('omits the search param entirely when no term is given', async () => {
    mockedRequest.get.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });

    await getAdminUsers({ limit: 50, offset: 0 });

    expect(mockedRequest.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/users$/), {
      params: { limit: 50, offset: 0 },
    });
  });

  it('passes the search term through so the server does the filtering', async () => {
    mockedRequest.get.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });

    await getAdminUsers({ limit: 50, offset: 0, search: 'ivan@example.com' });

    expect(mockedRequest.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/users$/), {
      params: { limit: 50, offset: 0, search: 'ivan@example.com' },
    });
  });

  it('forwards the roster filters the admin actually set', async () => {
    mockedRequest.get.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });

    await getAdminUsers({
      limit: 50,
      offset: 0,
      role: 'ADMIN',
      departmentId: 'none',
    });

    expect(mockedRequest.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/users$/), {
      params: { limit: 50, offset: 0, role: 'ADMIN', departmentId: 'none' },
    });
  });

  it('omits filters left empty instead of sending blanks', async () => {
    mockedRequest.get.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });

    await getAdminUsers({ limit: 50, offset: 0, role: '', departmentId: '', search: '' });

    expect(mockedRequest.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/users$/), {
      params: { limit: 50, offset: 0 },
    });
  });

  it('returns the update-user response as-is, so callers get the updated user', async () => {
    const response: AdminUpdateUserResponse = { user: USER };
    mockedRequest.patch.mockResolvedValue(response);

    const result = await updateAdminUser('user-1', {});

    expect(result).toEqual(response);
  });

  it('unwraps the get-user-by-id response down to the bare user, not the { user } envelope', async () => {
    const response: AdminUpdateUserResponse = { user: USER };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminUser('user-1');

    expect(result).toEqual(USER);
    expect(result).not.toHaveProperty('user');
    expect(mockedRequest.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/users\/user-1$/),
    );
  });

  it('unwraps the departments-list envelope down to a bare array', async () => {
    const response: AdminDepartmentsListResponse = { departments: [DEPARTMENT] };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminDepartments();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([DEPARTMENT]);
  });

  it('unwraps the update-department response down to the bare department', async () => {
    const response: AdminUpdateDepartmentResponse = { department: DEPARTMENT };
    mockedRequest.patch.mockResolvedValue(response);

    const result = await updateAdminDepartment('dept-1', {});

    expect(result).toEqual(DEPARTMENT);
  });

  it('unwraps the settings response down to the bare settings object', async () => {
    const response: AdminSettingsResponse = {
      settings: {
        systemPrompt: 'Be helpful.',
        allowedModels: ['gpt-4o'],
        defaultModel: null,
        defaultLimits: DEPARTMENT.defaultLimits,
        modelCapabilities: {},
      },
    };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminSettings();

    expect(result).toEqual(response.settings);
    expect(result).not.toHaveProperty('settings');
  });

  it('unwraps the limit-requests-list envelope down to a bare array', async () => {
    const response: AdminLimitRequestsListResponse = { requests: [LIMIT_REQUEST] };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminLimitRequests('pending');

    expect(result).toEqual([LIMIT_REQUEST]);
  });

  it('unwraps the approve-limit-request response down to the bare request', async () => {
    const response: AdminLimitRequestResponse = {
      request: { ...LIMIT_REQUEST, status: 'approved' },
    };
    mockedRequest.post.mockResolvedValue(response);

    const result = await approveLimitRequest('req-1', { limits: { dailyCostUsd: 500 } });

    expect(result).toEqual(response.request);
    expect(result.status).toBe('approved');
  });

  it('unwraps the reject-limit-request response down to the bare request', async () => {
    const response: AdminLimitRequestResponse = {
      request: { ...LIMIT_REQUEST, status: 'rejected' },
    };
    mockedRequest.post.mockResolvedValue(response);

    const result = await rejectLimitRequest('req-1');

    expect(result.status).toBe('rejected');
  });

  it('unwraps the analytics response down to a bare array of rows', async () => {
    const response: AdminAnalyticsResponse = {
      rows: [
        {
          key: 'dept-1',
          label: 'Legal',
          costUsd: 100,
          requests: 10,
          promptTokens: 1000,
          completionTokens: 500,
          unknownCostRequests: 0,
        },
      ],
    };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminAnalytics({
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'department',
    });

    expect(result).toEqual(response.rows);
  });

  it('passes the spend log through unchanged — it is already a flat { rows, total } shape', async () => {
    const response: AdminSpendListResponse = { rows: [], total: 0 };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminSpendLog({
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 25,
      skip: 0,
    });

    expect(result).toEqual(response);
  });

  it('unwraps the models-list envelope down to a bare array', async () => {
    const models: AdminModelOption[] = [
      { id: 'gpt-4o', label: 'GPT-4o', description: '' },
      { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', description: '' },
    ];
    const response: AdminModelsListResponse = { models };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminModels();

    expect(result).toEqual(models);
    expect(result).not.toHaveProperty('models');
  });

  it('passes the activity summary through unchanged — it is already a flat response shape', async () => {
    const response: AdminActivityResponse = {
      activeUsers: 7,
      requests: 143,
      avgRequestsPerUser: 20.4,
      returningUsers: 5,
      avgActiveDaysPerUser: 4.2,
      feedback: { thumbsUp: 12, thumbsDown: 3 },
    };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminActivity({ from: '2026-01-01', to: '2026-01-31' });

    expect(result).toEqual(response);
    expect(mockedRequest.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/analytics\/activity$/),
      { params: { from: '2026-01-01', to: '2026-01-31' } },
    );
  });

  it('forwards activity params as given, leaving unset fields out of the params object entirely', async () => {
    const response: AdminActivityResponse = {
      activeUsers: 0,
      requests: 0,
      avgRequestsPerUser: 0,
      returningUsers: 0,
      avgActiveDaysPerUser: 0,
      feedback: { thumbsUp: 0, thumbsDown: 0 },
    };
    mockedRequest.get.mockResolvedValue(response);

    await getAdminActivity({});

    expect(mockedRequest.get).toHaveBeenCalledWith(expect.any(String), { params: {} });
    const [, options] = mockedRequest.get.mock.calls[0] as [string, { params: object }];
    expect(options.params).not.toHaveProperty('from');
    expect(options.params).not.toHaveProperty('to');
  });

  it('passes the feedback log through unchanged — it is already a flat { rows, total } shape', async () => {
    const response: AdminFeedbackListResponse = {
      rows: [
        {
          messageId: 'abc',
          conversationId: 'def',
          userId: '6512abc',
          userName: 'Иван Петров',
          model: 'google/gemini-3.5-flash',
          rating: 'thumbsDown',
          tag: 'not_accurate',
          text: 'перепутал даты в ответе',
          date: '2026-08-26T10:00:00.000Z',
        },
      ],
      total: 12,
    };
    mockedRequest.get.mockResolvedValue(response);

    const result = await getAdminFeedback({
      from: '2026-01-01',
      to: '2026-01-31',
      rating: 'thumbsDown',
      limit: 25,
      skip: 0,
    });

    expect(result).toEqual(response);
    expect(mockedRequest.get).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/feedback$/), {
      params: { from: '2026-01-01', to: '2026-01-31', rating: 'thumbsDown', limit: 25, skip: 0 },
    });
  });

  it('forwards only the given feedback params, leaving rating/limit/skip out when unset', async () => {
    const response: AdminFeedbackListResponse = { rows: [], total: 0 };
    mockedRequest.get.mockResolvedValue(response);

    await getAdminFeedback({ from: '2026-01-01' });

    const [, options] = mockedRequest.get.mock.calls[0] as [string, { params: object }];
    expect(options.params).toEqual({ from: '2026-01-01' });
    expect(options.params).not.toHaveProperty('rating');
    expect(options.params).not.toHaveProperty('limit');
    expect(options.params).not.toHaveProperty('skip');
  });
});
