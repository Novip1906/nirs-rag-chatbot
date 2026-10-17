import type { TFeedbackRating } from '../feedback';

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
  position: string;
  name: string;
  email: string;
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
  spendToday: AdminSpendTotals;
  spendMonth: AdminSpendTotals;
  /**
   * Knowledge-base space overrides on top of the department (see the knowledge-base
   * design, §5): `allowedSpaces` grants spaces beyond the department, `deniedSpaces`
   * revokes and wins over everything else. Optional rather than defaulted to `[]` so
   * existing `AdminUserListItem` fixtures elsewhere don't need updating for a field
   * they don't exercise.
   */
  allowedSpaces?: string[];
  deniedSpaces?: string[];
  /** Персональное право загружать документы в базу знаний своего отдела. */
  canUploadKnowledge: boolean;
}

export interface AdminUsersListResponse {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export type AdminUserStatus = 'active' | 'blocked';

/** `'none'` selects users with no department, including those with no policy document. */
export const ADMIN_NO_DEPARTMENT = 'none';

export interface AdminUserListQuery {
  limit: number;
  offset: number;
  search?: string;
  role?: string;
  departmentId?: string;
  status?: AdminUserStatus;
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

export interface AdminUpdateUserAiRoleRequest {
  role: 'HEAD' | 'USER';
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
 * (`express-mongo-sanitize`) вырезает из тела ключи с точкой, а точка есть почти в каждом
 * идентификаторе: `gpt-5.6-luna`, `gemini-3.7-flash`, `claude-haiku-4.5`. Настройки таких
 * моделей молча не доезжали до сервера.
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
  /** Effective cost limit for the window when the request was raised. */
  limitBefore: number | null;
  /** Cost limit granted on approval. */
  limitAfter: number | null;
  /** The same user's earlier requests, newest first, excluding this one. */
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

/** One LLM call inside a request — a tool round trip, or the chat-title generation. */
export interface AdminSpendCall {
  model: string;
  scenario: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  createdAt: string;
}

/**
 * One employee request: the answer plus every LLM call it took. Keyed by the answer's
 * `messageId`, the same key the analytics page counts requests by. A row with no
 * `messageId` — knowledge-base indexing — stands alone under its own record id.
 */
export interface AdminSpendRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  /** The model the employee's own turn ran on, with the rest listed in `models`. */
  model: string;
  models: string[];
  conversationId?: string;
  messageId?: string;
  calls: AdminSpendCall[];
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Calls the provider returned no price for; their cost is not in `costUsd`. */
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
  images: AdminSpendImage[];
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

export interface UsageWindowLimits {
  costUsd: number | null;
}

export interface UsageWindowSummary {
  costUsd: number;
  requests: number;
  limits: UsageWindowLimits;
}

/** Actual spend only, no threshold — there is no monthly limit to check it against
 *  (mirrors `spendMonth` in the admin user list, a report rather than an enforcement). */
export interface UsageTotals {
  costUsd: number;
  requests: number;
}

export interface UsagePendingRequest {
  id: string;
  window: LimitWindow;
  createdAt: string;
}

export interface UsageMeResponse {
  daily: UsageWindowSummary;
  monthly: UsageTotals;
  pendingRequests: UsagePendingRequest[];
}

export interface RequestLimitIncreaseRequest {
  window: LimitWindow;
  comment?: string;
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
