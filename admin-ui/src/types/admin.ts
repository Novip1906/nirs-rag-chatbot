import type { TFeedbackRating } from './feedback';
import { SystemRoles } from './roles';

export type LimitWindow = 'daily';

export type LimitRequestStatus = 'pending' | 'approved' | 'rejected';

export type SpendGroupBy = 'user' | 'department' | 'model' | 'day' | 'scenario';

export type CostSource = 'provider' | 'estimate' | 'unknown';

export interface AdminLimits {
  dailyCostUsd: number | null;
}

export type AdminPartialLimits = Partial<AdminLimits>;

export interface AdminSpendTotals {
  costUsd: number;
  requests: number;
}

export interface AdminUserListItem {
  id: string;
  employeeId: string | null;
  openidId: string | null;
  name: string;
  email: string;
  position: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  limits: AdminLimits;
  limitsOverride: AdminPartialLimits | null;
  allowedModels: string[];
  allowedModelsOverride: string[] | null;
  defaultModel: string | null;
  defaultModelOverride: string | null;
  blocked: boolean;
  canUploadKnowledge: boolean;
  spendToday: AdminSpendTotals;
  spendMonth: AdminSpendTotals;
  allowedSpaces?: string[];
  deniedSpaces?: string[];
}

export interface AdminUsersListResponse {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const ADMIN_NO_DEPARTMENT = 'none';

export interface AdminUserListQuery {
  limit: number;
  offset: number;
  search?: string;
  role?: string;
  departmentId?: string;
}

export interface AdminUpdateUserRequest {
  limits?: AdminPartialLimits | null;
  allowedModels?: string[] | null;
  defaultModel?: string | null;
  allowedSpaces?: string[];
  deniedSpaces?: string[];
  canUploadKnowledge?: boolean;
}

export interface AdminUpdateUserResponse {
  user: AdminUserListItem;
}

export interface AdminDepartment {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: AdminLimits;
  directoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDepartmentsListResponse {
  departments: AdminDepartment[];
}

export interface AdminUpdateDepartmentRequest {
  systemPrompt?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  defaultLimits?: AdminPartialLimits;
}

export interface AdminUpdateDepartmentResponse {
  department: AdminDepartment;
}

export interface AdminModelPricing {
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  imageInputPerMillion: number | null;
  audioPerMillion: number | null;
  webSearchPerThousand: number | null;
  inputCacheReadPerMillion: number | null;
  inputCacheWritePerMillion: number | null;
  currency: string | null;
}

/** From the provider catalog's `architecture.input_modalities` — what a model accepts
 *  as input, beyond plain text. */
export type AdminModelInputModality = 'text' | 'image' | 'file' | 'audio' | 'video';

export interface AdminModelOption {
  id: string;
  label: string;
  description: string;
  vendor?: string | null;
  contextLength?: number | null;
  pricing?: AdminModelPricing | null;
  inputModalities?: AdminModelInputModality[];
  shortDescription?: string | null;
}

export interface AdminModelsListResponse {
  models: AdminModelOption[];
}

export interface AdminModelCapabilityFlags {
  knowledgeBase?: boolean;
  webSearch?: boolean;
  label?: string;
  description?: string;
}

/**
 * Keyed by provider model id. Global only — whether a model can reliably use tools is a
 * fact about the model, not about which department/user is asking, so this lives on
 * `AdminSettings` rather than being duplicated per department/user policy.
 */
export type AdminModelCapabilitiesMap = Record<string, AdminModelCapabilityFlags>;

/**
 * Тот же набор настроек, но списком: при сохранении идентификатор модели едет значением
 * поля, а не ключом объекта. Ключом он ехать не может — защита от инъекций в запросах
 * вырезает из тела ключи с точкой, а точка есть почти в каждом идентификаторе:
 * `gpt-5.6-luna`, `gemini-3.7-flash`, `claude-haiku-4.5`. Настройки таких моделей молча
 * не доезжали до сервера, и сохранялись только модели без точки в имени.
 */
export interface AdminModelCapabilityEntry extends AdminModelCapabilityFlags {
  modelId: string;
}

export interface AdminSettings {
  systemPrompt: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: AdminLimits;
  modelCapabilities: AdminModelCapabilitiesMap;
}

export interface AdminSettingsResponse {
  settings: AdminSettings;
}

export interface AdminUpdateSettingsRequest {
  systemPrompt?: string;
  allowedModels?: string[];
  defaultModel?: string | null;
  defaultLimits?: AdminPartialLimits;
  modelCapabilities?: AdminModelCapabilityEntry[];
}

export interface AdminLimitRequestHistoryEntry {
  id: string;
  window: LimitWindow;
  status: LimitRequestStatus;
  limitBefore: number | null;
  limitAfter: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminLimitRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  window: LimitWindow;
  comment?: string;
  status: LimitRequestStatus;
  limitBefore: number | null;
  limitAfter: number | null;
  history: AdminLimitRequestHistoryEntry[];
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AdminLimitRequestsListResponse {
  requests: AdminLimitRequest[];
}

export interface AdminApproveLimitRequestRequest {
  limits: AdminPartialLimits;
}

export interface AdminLimitRequestResponse {
  request: AdminLimitRequest;
}

export interface AdminSpendCall {
  model: string;
  scenario: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  createdAt: string;
}

export interface AdminSpendRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  model: string;
  models: string[];
  conversationId?: string;
  messageId?: string;
  calls: AdminSpendCall[];
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unknownCostCalls: number;
  scenario: string;
  createdAt: string;
}

export interface AdminSpendImage {
  fileId: string;
  prompt: string;
  model: string;
  createdAt?: string;
}

export interface AdminSpendTranscript {
  messageId: string;
  conversationId?: string;
  conversationTitle?: string;
  question: string;
  answer: string;
  model?: string;
  askedAt?: string;
  answeredAt?: string;
  images?: AdminSpendImage[];
}

export interface AdminSpendQueryParams {
  from?: string;
  to?: string;
  userId?: string;
  departmentId?: string;
  model?: string;
  limit?: number;
  skip?: number;
}

export interface AdminSpendListResponse {
  rows: AdminSpendRequest[];
  total: number;
}

export interface AdminSpendTranscriptResponse {
  transcript: AdminSpendTranscript | null;
}

export interface AdminAnalyticsRow {
  key: string;
  label: string;
  costUsd: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  unknownCostRequests: number;
}

export interface AdminAnalyticsQueryParams {
  from?: string;
  to?: string;
  groupBy: SpendGroupBy;
}

export interface AdminAnalyticsResponse {
  rows: AdminAnalyticsRow[];
}

export interface AdminActivityQueryParams {
  from?: string;
  to?: string;
}

export interface AdminFeedbackCounts {
  thumbsUp: number;
  thumbsDown: number;
}

export interface AdminActivityResponse {
  activeUsers: number;
  requests: number;
  avgRequestsPerUser: number;
  returningUsers: number;
  avgActiveDaysPerUser: number;
  feedback: AdminFeedbackCounts;
}

export interface AdminFeedbackRow {
  messageId: string;
  conversationId: string;
  userId: string;
  userName: string;
  model: string;
  rating: TFeedbackRating;
  tag: string;
  text: string;
  date: string;
}

export interface AdminFeedbackQueryParams {
  from?: string;
  to?: string;
  rating?: TFeedbackRating;
  limit?: number;
  skip?: number;
}

export interface AdminFeedbackListResponse {
  rows: AdminFeedbackRow[];
  total: number;
}

export type AdminProviderBalanceStatus = 'ok' | 'unavailable' | 'not_configured';

export interface AdminProviderBalance {
  provider: string;
  status: AdminProviderBalanceStatus;
  amountUsd: number | null;
  checkedAt: string;
}

export interface AdminProviderBalanceResponse {
  balance: AdminProviderBalance;
}

/**
 * Полномочия вошедшего — набор capability, роль и отдел (для главы). Навигация и
 * карточки строятся из этого набора, а не из роли: сервер решает, что доступно, клиент
 * только отражает решение.
 */
export interface AdminCapabilitiesResponse {
  capabilities: string[];
  role: string;
  departmentId: string | null;
  /**
   * `GET /admin/departments` (список всех отделов) требует админ-уровня и главе всегда
   * отвечает 403 — без этого поля ей негде было бы узнать название даже собственного
   * отдела: любая форма, показывающая «свой отдел» текстом, а не выбором, зависела бы
   * от запроса, на который у неё нет прав.
   */
  departmentName: string | null;
}

/**
 * Полномочия роли на память сотрудника. Хранятся не в настройках офиса, а в ролях
 * самого LibreChat (`PUT /api/roles/:roleName/memories`), поэтому и тип отдельный от
 * `AdminSettings`.
 */
export interface MemoryRolePermissions {
  USE: boolean;
  CREATE: boolean;
  UPDATE: boolean;
  READ: boolean;
  OPT_OUT: boolean;
}

/**
 * Роли, которым сервер вообще проставляет полномочия памяти — тот же список, что
 * перебирает `updateInterfacePermissions` в форке. Порядок здесь — порядок в
 * выпадающем списке: от той роли, которую меняют чаще всего.
 */
export const MEMORY_PERMISSION_ROLES: readonly SystemRoles[] = [
  SystemRoles.USER,
  SystemRoles.HEAD,
  SystemRoles.ADMIN,
  SystemRoles.OWNER,
];
