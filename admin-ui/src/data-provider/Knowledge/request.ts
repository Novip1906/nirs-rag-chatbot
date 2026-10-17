import { apiBaseUrl, request } from '~/api';
import type {
  KnowledgeDocumentInput,
  KnowledgeDocumentItem,
  KnowledgeDocumentResponse,
  KnowledgeDocumentsListResponse,
  KnowledgeReindexResponse,
  KnowledgeSpaceInput,
  KnowledgeSpaceItem,
  KnowledgeSpaceResponse,
  KnowledgeSpacesListResponse,
} from '~/api';
import type { AxiosResponse } from 'axios';

/**
 * Every list/detail endpoint here wraps its payload in a named envelope
 * (`{ spaces }`, `{ space }`, `{ documents }`, `{ document }`), same convention as
 * `Admin/request.ts` — unwrapped here so every caller works with plain data, never
 * the envelope shape.
 */
const knowledgeBase = (): string => `${apiBaseUrl()}/api/office/admin/knowledge`;

/**
 * The employee-facing document routes: `knowledgeBase()` above is admin-only
 * (space/document CRUD), while this is the route any employee authorized for
 * the document's space goes through to preview or download it.
 */
const knowledgeDocumentsBase = (): string => `${apiBaseUrl()}/api/office/knowledge/documents`;

export const getKnowledgeSpaces = async (): Promise<KnowledgeSpaceItem[]> => {
  const response: KnowledgeSpacesListResponse = await request.get(`${knowledgeBase()}/spaces`);
  return response.spaces;
};

export const createKnowledgeSpace = async (
  payload: KnowledgeSpaceInput,
): Promise<KnowledgeSpaceItem> => {
  const response: KnowledgeSpaceResponse = await request.post(`${knowledgeBase()}/spaces`, payload);
  return response.space;
};

export const updateKnowledgeSpace = async (
  id: string,
  payload: Partial<KnowledgeSpaceInput>,
): Promise<KnowledgeSpaceItem> => {
  const response: KnowledgeSpaceResponse = await request.patch(
    `${knowledgeBase()}/spaces/${encodeURIComponent(id)}`,
    payload,
  );
  return response.space;
};

export const deleteKnowledgeSpace = async (id: string): Promise<void> => {
  await request.delete(`${knowledgeBase()}/spaces/${encodeURIComponent(id)}`);
};

export const getKnowledgeDocuments = async (spaceId: string): Promise<KnowledgeDocumentItem[]> => {
  const response: KnowledgeDocumentsListResponse = await request.get(
    `${knowledgeBase()}/spaces/${encodeURIComponent(spaceId)}/documents`,
  );
  return response.documents;
};

function appendMetadata(formData: FormData, metadata: KnowledgeDocumentInput): void {
  Object.entries(metadata).forEach(([key, value]) => {
    if (value != null) {
      formData.append(key, String(value));
    }
  });
}

export const uploadKnowledgeDocument = async (
  spaceId: string,
  file: File,
  metadata: KnowledgeDocumentInput,
): Promise<KnowledgeDocumentItem> => {
  const formData = new FormData();
  formData.append('file', file);
  appendMetadata(formData, metadata);
  const response: KnowledgeDocumentResponse = await request.postMultiPart(
    `${knowledgeBase()}/spaces/${encodeURIComponent(spaceId)}/documents`,
    formData,
  );
  return response.document;
};

export const updateKnowledgeDocument = async (
  id: string,
  payload: Partial<KnowledgeDocumentInput>,
): Promise<KnowledgeDocumentItem> => {
  const response: KnowledgeDocumentResponse = await request.patch(
    `${knowledgeBase()}/documents/${encodeURIComponent(id)}`,
    payload,
  );
  return response.document;
};

export const deleteKnowledgeDocument = async (id: string): Promise<void> => {
  await request.delete(`${knowledgeBase()}/documents/${encodeURIComponent(id)}`);
};

export const reindexKnowledgeSpace = async (spaceId: string): Promise<KnowledgeReindexResponse> =>
  request.post(`${knowledgeBase()}/spaces/${encodeURIComponent(spaceId)}/reindex`);

export type KnowledgeDocumentPreviewKind = 'pdf' | 'html' | 'text';

export interface KnowledgeDocumentPreview {
  fileId: string;
  title: string;
  filename: string;
  mimetype: string;
  bytes: number;
  kind: KnowledgeDocumentPreviewKind;
  /** Present only when `kind === 'html'`: a self-contained, server-sanitized HTML document. */
  html?: string;
  /** Present only when `kind === 'text'`. */
  text?: string;
}

export const getKnowledgeDocumentPreview = async (
  fileId: string,
): Promise<KnowledgeDocumentPreview> =>
  request.get(`${knowledgeDocumentsBase()}/${encodeURIComponent(fileId)}/preview`);

export interface KnowledgeDocumentFileOptions {
  download?: boolean;
}

export const getKnowledgeDocumentFile = async (
  fileId: string,
  options?: KnowledgeDocumentFileOptions,
): Promise<AxiosResponse> => {
  const query = options?.download === true ? '?download=1' : '';
  return request.getResponse(
    `${knowledgeDocumentsBase()}/${encodeURIComponent(fileId)}/file${query}`,
    {
      responseType: 'blob',
      headers: {
        Accept: 'application/octet-stream',
      },
    },
  );
};
