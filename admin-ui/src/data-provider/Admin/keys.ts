import type { QueryKey } from '@tanstack/react-query';
import type {
  AdminActivityQueryParams,
  AdminAnalyticsQueryParams,
  AdminFeedbackQueryParams,
  AdminSpendQueryParams,
  AdminUserListQuery,
  LimitRequestStatus,
} from '~/api';

export const adminKeys = {
  capabilities: ['admin', 'capabilities'] as QueryKey,
  usersRoot: ['admin', 'users'] as QueryKey,
  /** The whole query object is the key: seven positional arguments stop being readable. */
  users: (query: AdminUserListQuery): QueryKey => ['admin', 'users', query],
  /** Prefix shared by every `user(id)` query key — invalidate this to catch every open
   *  single-user page at once, when the affected user ids aren't known individually
   *  (e.g. a department or global-settings change that ripples into inherited fields). */
  userRoot: ['admin', 'user'] as QueryKey,
  user: (id: string | null | undefined): QueryKey => ['admin', 'user', id],
  models: ['admin', 'models'] as QueryKey,
  providerBalance: ['admin', 'providerBalance'] as QueryKey,
  departments: ['admin', 'departments'] as QueryKey,
  settings: ['admin', 'settings'] as QueryKey,
  memoryPermissionsRoot: ['admin', 'memoryPermissions'] as QueryKey,
  memoryPermissions: (roleName: string): QueryKey => ['admin', 'memoryPermissions', roleName],
  limitRequests: (status?: LimitRequestStatus): QueryKey => [
    'admin',
    'limitRequests',
    status ?? 'pending',
  ],
  spend: (params: AdminSpendQueryParams): QueryKey => ['admin', 'spend', params],
  spendTranscript: (messageId: string): QueryKey => ['admin', 'spend', 'transcript', messageId],
  spendImage: (messageId: string, fileId: string): QueryKey => [
    'admin',
    'spend',
    'image',
    messageId,
    fileId,
  ],
  analytics: (params: AdminAnalyticsQueryParams): QueryKey => ['admin', 'analytics', params],
  activity: (params: AdminActivityQueryParams): QueryKey => ['admin', 'activity', params],
  feedback: (params: AdminFeedbackQueryParams): QueryKey => ['admin', 'feedback', params],
};
