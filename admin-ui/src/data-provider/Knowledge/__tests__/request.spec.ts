import { request as httpRequest } from '~/api';
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
import type { KnowledgeDocumentPreview } from '../request';
import {
  createKnowledgeSpace,
  deleteKnowledgeDocument,
  deleteKnowledgeSpace,
  getKnowledgeDocumentFile,
  getKnowledgeDocumentPreview,
  getKnowledgeDocuments,
  getKnowledgeSpaces,
  reindexKnowledgeSpace,
  updateKnowledgeDocument,
  updateKnowledgeSpace,
  uploadKnowledgeDocument,
} from '../request';

/**
 * Every list/detail endpoint wraps its payload in a named envelope (`{ spaces }`,
 * `{ space }`, ...), same convention as `Admin/request.ts` — unwrapped here so every
 * caller works with plain data, never the envelope shape.
 */
jest.mock('~/api', () => ({
  ...jest.requireActual('~/api'),
  request: {
    get: jest.fn(),
    getResponse: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    postMultiPart: jest.fn(),
  },
}));

const mockedRequest = httpRequest as unknown as {
  get: jest.Mock;
  getResponse: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
  postMultiPart: jest.Mock;
};

const SPACE: KnowledgeSpaceItem = {
  id: 'space-1',
  name: 'Корпоративные стандарты',
  description: '',
  allowedDepartments: [],
  embeddingModel: 'baai/bge-m3',
  enabled: true,
  documentCount: 0,
};

const DOCUMENT: KnowledgeDocumentItem = {
  id: 'doc-1',
  spaceId: 'space-1',
  fileId: 'file-1',
  title: 'Регламент',
  filename: 'reglament.pdf',
  source: '',
  owner: '',
  uploadedBy: 'user-1',
  version: '',
  effectiveDate: null,
  status: 'active',
  embeddingModel: 'baai/bge-m3',
  bytes: 100,
  mimetype: 'application/pdf',
  embedded: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Knowledge request layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getKnowledgeSpaces unwraps { spaces }', async () => {
    mockedRequest.get.mockResolvedValue({
      spaces: [SPACE],
    } satisfies KnowledgeSpacesListResponse);

    await expect(getKnowledgeSpaces()).resolves.toEqual([SPACE]);
    expect(mockedRequest.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces'),
    );
  });

  it('createKnowledgeSpace posts to /spaces and unwraps { space }', async () => {
    const payload: KnowledgeSpaceInput = { name: 'Юридическое' };
    mockedRequest.post.mockResolvedValue({ space: SPACE } satisfies KnowledgeSpaceResponse);

    await expect(createKnowledgeSpace(payload)).resolves.toEqual(SPACE);
    expect(mockedRequest.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces'),
      payload,
    );
  });

  it('updateKnowledgeSpace patches /spaces/:id and unwraps { space }', async () => {
    mockedRequest.patch.mockResolvedValue({ space: SPACE } satisfies KnowledgeSpaceResponse);

    await expect(updateKnowledgeSpace('space-1', { enabled: false })).resolves.toEqual(SPACE);
    expect(mockedRequest.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces/space-1'),
      { enabled: false },
    );
  });

  it('deleteKnowledgeSpace deletes /spaces/:id', async () => {
    mockedRequest.delete.mockResolvedValue(undefined);

    await deleteKnowledgeSpace('space-1');
    expect(mockedRequest.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces/space-1'),
    );
  });

  it('getKnowledgeDocuments unwraps { documents } for the given space', async () => {
    mockedRequest.get.mockResolvedValue({
      documents: [DOCUMENT],
    } satisfies KnowledgeDocumentsListResponse);

    await expect(getKnowledgeDocuments('space-1')).resolves.toEqual([DOCUMENT]);
    expect(mockedRequest.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces/space-1/documents'),
    );
  });

  it('uploadKnowledgeDocument sends multipart form data with the file and metadata', async () => {
    mockedRequest.postMultiPart.mockResolvedValue({
      document: DOCUMENT,
    } satisfies KnowledgeDocumentResponse);
    const file = new File(['content'], 'reglament.pdf', { type: 'application/pdf' });
    const metadata: KnowledgeDocumentInput = { title: 'Регламент', status: 'active' };

    await expect(uploadKnowledgeDocument('space-1', file, metadata)).resolves.toEqual(DOCUMENT);

    expect(mockedRequest.postMultiPart).toHaveBeenCalledTimes(1);
    const [url, formData] = mockedRequest.postMultiPart.mock.calls[0];
    expect(url).toEqual(
      expect.stringContaining('/api/office/admin/knowledge/spaces/space-1/documents'),
    );
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('file')).toBe(file);
    expect(formData.get('title')).toBe('Регламент');
    expect(formData.get('status')).toBe('active');
  });

  it('uploadKnowledgeDocument omits metadata fields that are null or undefined', async () => {
    mockedRequest.postMultiPart.mockResolvedValue({
      document: DOCUMENT,
    } satisfies KnowledgeDocumentResponse);
    const file = new File(['content'], 'reglament.pdf', { type: 'application/pdf' });

    await uploadKnowledgeDocument('space-1', file, { title: 'Регламент', effectiveDate: null });

    const [, formData] = mockedRequest.postMultiPart.mock.calls[0];
    expect(formData.has('effectiveDate')).toBe(false);
  });

  it('updateKnowledgeDocument patches /documents/:id and unwraps { document }', async () => {
    mockedRequest.patch.mockResolvedValue({
      document: DOCUMENT,
    } satisfies KnowledgeDocumentResponse);

    await expect(updateKnowledgeDocument('doc-1', { status: 'archived' })).resolves.toEqual(
      DOCUMENT,
    );
    expect(mockedRequest.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/documents/doc-1'),
      { status: 'archived' },
    );
  });

  it('deleteKnowledgeDocument deletes /documents/:id', async () => {
    mockedRequest.delete.mockResolvedValue(undefined);

    await deleteKnowledgeDocument('doc-1');
    expect(mockedRequest.delete).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/documents/doc-1'),
    );
  });

  it('reindexKnowledgeSpace posts to /spaces/:id/reindex', async () => {
    const response = { reindexed: 3, skipped: [] } satisfies KnowledgeReindexResponse;
    mockedRequest.post.mockResolvedValue(response);

    await expect(reindexKnowledgeSpace('space-1')).resolves.toEqual(response);
    expect(mockedRequest.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/admin/knowledge/spaces/space-1/reindex'),
    );
  });

  it('getKnowledgeDocumentPreview hits the employee-facing route, not the admin one', async () => {
    const preview: KnowledgeDocumentPreview = {
      fileId: 'file-1',
      title: 'Регламент',
      filename: 'reglament.pdf',
      mimetype: 'application/pdf',
      bytes: 100,
      kind: 'pdf',
    };
    mockedRequest.get.mockResolvedValue(preview);

    await expect(getKnowledgeDocumentPreview('file-1')).resolves.toEqual(preview);
    expect(mockedRequest.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/knowledge/documents/file-1/preview'),
    );
    expect(mockedRequest.get.mock.calls[0][0]).not.toContain('/admin/');
  });

  it('getKnowledgeDocumentFile requests the inline route without a download flag by default', async () => {
    const response = { data: new Blob(['pdf-bytes']) };
    mockedRequest.getResponse.mockResolvedValue(response);

    await expect(getKnowledgeDocumentFile('file-1')).resolves.toBe(response);
    expect(mockedRequest.getResponse).toHaveBeenCalledWith(
      expect.stringContaining('/api/office/knowledge/documents/file-1/file'),
      expect.objectContaining({
        responseType: 'blob',
        headers: { Accept: 'application/octet-stream' },
      }),
    );
    expect(mockedRequest.getResponse.mock.calls[0][0]).not.toContain('?download=1');
  });

  it('getKnowledgeDocumentFile appends ?download=1 when downloading', async () => {
    mockedRequest.getResponse.mockResolvedValue({ data: new Blob(['pdf-bytes']) });

    await getKnowledgeDocumentFile('file-1', { download: true });
    expect(mockedRequest.getResponse.mock.calls[0][0]).toEqual(
      expect.stringContaining('/api/office/knowledge/documents/file-1/file?download=1'),
    );
  });
});
