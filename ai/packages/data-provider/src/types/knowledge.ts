export type KnowledgeDocumentStatus = 'active' | 'archived' | 'draft';

/**
 * Общий с сервером источник правды для загрузки документов базы знаний: сервер
 * (`packages/api/src/corporate/knowledge/employee.ts`, `mime.ts`) принимает эти же
 * расширения и этот же лимит размера. Хранится здесь, а не только на сервере, чтобы
 * клиент (`UploadDialog`) мог отсечь заведомо непроходной файл до отправки, не
 * выдумывая собственный, независимый список. `employee.spec.ts` в `packages/api`
 * проверяет, что сервер действительно принимает каждое из этих расширений.
 */
export const KNOWLEDGE_DOCUMENT_EXTENSIONS: readonly string[] = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'md',
  'csv',
];

export const KNOWLEDGE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export interface KnowledgeSpaceItem {
  id: string;
  name: string;
  description: string;
  allowedDepartments: string[];
  embeddingModel: string;
  enabled: boolean;
  documentCount: number;
}

export interface KnowledgeSpaceSummary {
  id: string;
  name: string;
  allowedDepartments: string[];
  enabled: boolean;
  canWrite: boolean;
  /** Может ли текущий пользователь переименовать/удалить это пространство. */
  canManage: boolean;
}

export interface KnowledgeSpaceSummariesResponse {
  spaces: KnowledgeSpaceSummary[];
}

export interface KnowledgeSpaceSummaryResponse {
  space: KnowledgeSpaceSummary;
}

export interface KnowledgeSpaceSummaryInput {
  name: string;
  description?: string;
}

export interface KnowledgeDocumentItem {
  id: string;
  spaceId: string;
  fileId: string;
  title: string;
  description: string;
  filename: string;
  source: string;
  owner: string;
  uploadedBy: string;
  /**
   * Отображаемое имя загрузившего (или почта, если имени нет) — заполняется только
   * админским роутером, где id разрешаются пачкой; роутер сотрудника оставляет поле
   * не заданным.
   */
  uploadedByName?: string;
  version: string;
  effectiveDate: string | null;
  status: KnowledgeDocumentStatus;
  embeddingModel: string;
  bytes: number;
  mimetype: string;
  embedded: boolean;
  createdAt: string;
}

export interface KnowledgeSpacesListResponse {
  spaces: KnowledgeSpaceItem[];
}

export interface KnowledgeDocumentsListResponse {
  documents: KnowledgeDocumentItem[];
}

export interface KnowledgeSpaceResponse {
  space: KnowledgeSpaceItem;
}

export interface KnowledgeDocumentResponse {
  document: KnowledgeDocumentItem;
}

export interface KnowledgeReindexResponse {
  queued: number;
}

export interface KnowledgeSpaceInput {
  name: string;
  description?: string;
  allowedDepartments?: string[];
  enabled?: boolean;
}

export interface KnowledgeDocumentInput {
  title: string;
  description?: string;
  source?: string;
  owner?: string;
  version?: string;
  effectiveDate?: string | null;
  status?: KnowledgeDocumentStatus;
  supersedesId?: string | null;
}
