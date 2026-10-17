export type KnowledgeDocumentStatus = 'active' | 'archived' | 'draft';

export interface KnowledgeSpaceItem {
  id: string;
  name: string;
  description: string;
  allowedDepartments: string[];
  embeddingModel: string;
  enabled: boolean;
  documentCount: number;
}

export interface KnowledgeDocumentItem {
  id: string;
  spaceId: string;
  fileId: string;
  title: string;
  filename: string;
  source: string;
  owner: string;
  uploadedBy: string;
  /** Отображаемое имя загрузившего (или почта, если имени нет); пусто, если такого сотрудника уже нет в системе. */
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

export interface KnowledgeReindexSkippedDocument {
  title: string;
  reason: string;
}

export interface KnowledgeReindexResponse {
  reindexed: number;
  skipped: KnowledgeReindexSkippedDocument[];
}

export interface KnowledgeSpaceInput {
  name: string;
  description?: string;
  allowedDepartments?: string[];
  enabled?: boolean;
}

export interface KnowledgeDocumentInput {
  title: string;
  source?: string;
  owner?: string;
  version?: string;
  effectiveDate?: string | null;
  status?: KnowledgeDocumentStatus;
  supersedesId?: string | null;
}
