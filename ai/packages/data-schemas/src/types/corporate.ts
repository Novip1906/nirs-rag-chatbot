import type { Document, Types } from 'mongoose';

export interface ILimits {
  dailyCostUsd: number | null;
}

export type PartialLimits = Partial<ILimits>;

export type CostSource = 'provider' | 'estimate' | 'unknown';

export interface IModelCapabilityFlags {
  knowledgeBase?: boolean;
  webSearch?: boolean;
  /**
   * Админское переопределение того, что сотрудник видит в выборе модели — сильнее
   * каталога провайдера и именных спеков `librechat.yaml` (см. `modelFilter.ts`).
   * Пустая строка на входе не сохраняется (см. `validateModelCapabilities`), поэтому
   * здесь либо свой текст, либо поля нет вовсе.
   */
  label?: string;
  description?: string;
}

/** Keyed by provider model id (e.g. `google/gemini-3.5-flash-lite`). Global, not per-department/user:
 *  whether a model can reliably use tools is a fact about the model, not about who's asking. */
export type ModelCapabilitiesMap = Record<string, IModelCapabilityFlags>;

export interface IDepartment extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  systemPrompt?: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: ILimits;
  directoryId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUserPolicy extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId?: Types.ObjectId | null;
  limits?: PartialLimits | null;
  allowedModels?: string[] | null;
  defaultModel?: string | null;
  blocked: boolean;
  allowedSpaces: Types.ObjectId[];
  deniedSpaces: Types.ObjectId[];
  canUploadKnowledge: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IUsageRecord extends Omit<Document, 'model'> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId?: Types.ObjectId | null;
  model: string;
  conversationId?: string;
  messageId?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  scenario?: string;
  imagePrompt?: string;
  imageFileId?: string;
  createdAt?: Date;
}

export interface ICorporateSettings extends Document {
  _id: Types.ObjectId;
  key: 'global';
  systemPrompt: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: ILimits;
  modelCapabilities: ModelCapabilitiesMap;
  updatedAt?: Date;
}

export type LimitWindow = 'daily';

export type LimitRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ILimitRequest extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  window: LimitWindow;
  comment?: string;
  status: LimitRequestStatus;
  /** Effective cost limit for the window at the moment the request was raised. */
  limitBefore?: number | null;
  /** Cost limit granted on approval; stays null for pending and rejected requests. */
  limitAfter?: number | null;
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  createdAt?: Date;
}
