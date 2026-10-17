import { createElement } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { KnowledgeDocumentItem, KnowledgeSpaceItem } from '~/api';
import {
  useCreateSpaceMutation,
  useDeleteDocumentMutation,
  useDeleteSpaceMutation,
  useReindexSpaceMutation,
  useUpdateDocumentMutation,
  useUpdateSpaceMutation,
  useUploadDocumentMutation,
} from '../mutations';
import { knowledgeKeys } from '../keys';

const mockCreateKnowledgeSpace = jest.fn();
const mockUpdateKnowledgeSpace = jest.fn();
const mockDeleteKnowledgeSpace = jest.fn();
const mockUploadKnowledgeDocument = jest.fn();
const mockUpdateKnowledgeDocument = jest.fn();
const mockDeleteKnowledgeDocument = jest.fn();
const mockReindexKnowledgeSpace = jest.fn();

jest.mock('../request', () => ({
  createKnowledgeSpace: (...args: unknown[]) => mockCreateKnowledgeSpace(...args),
  updateKnowledgeSpace: (...args: unknown[]) => mockUpdateKnowledgeSpace(...args),
  deleteKnowledgeSpace: (...args: unknown[]) => mockDeleteKnowledgeSpace(...args),
  uploadKnowledgeDocument: (...args: unknown[]) => mockUploadKnowledgeDocument(...args),
  updateKnowledgeDocument: (...args: unknown[]) => mockUpdateKnowledgeDocument(...args),
  deleteKnowledgeDocument: (...args: unknown[]) => mockDeleteKnowledgeDocument(...args),
  reindexKnowledgeSpace: (...args: unknown[]) => mockReindexKnowledgeSpace(...args),
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

function makeQueryClient() {
  return new QueryClient({
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

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

describe('Knowledge mutations — cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useCreateSpaceMutation invalidates the spaces list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockCreateKnowledgeSpace.mockResolvedValue(SPACE);
    const { result } = renderHook(() => useCreateSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Юридическое' });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.spaces);
    queryClient.clear();
  });

  it('useUpdateSpaceMutation invalidates the spaces list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUpdateKnowledgeSpace.mockResolvedValue(SPACE);
    const { result } = renderHook(() => useUpdateSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'space-1', payload: { enabled: false } });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.spaces);
    queryClient.clear();
  });

  it('useDeleteSpaceMutation invalidates the spaces list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockDeleteKnowledgeSpace.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('space-1');
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.spaces);
    queryClient.clear();
  });

  /**
   * Uploading a document changes the space's document count too, so both the
   * per-space document list and the spaces list (rendered in `SpacesView`) must
   * refresh — not just the list the mutation was triggered from.
   */
  it('useUploadDocumentMutation invalidates both the space documents and the spaces list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUploadKnowledgeDocument.mockResolvedValue(DOCUMENT);
    const { result } = renderHook(() => useUploadDocumentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        spaceId: 'space-1',
        file: new File(['x'], 'reglament.pdf'),
        metadata: { title: 'Регламент' },
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.documents('space-1'));
    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.spaces);
    queryClient.clear();
  });

  it('useUpdateDocumentMutation invalidates the owning space document list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockUpdateKnowledgeDocument.mockResolvedValue(DOCUMENT);
    const { result } = renderHook(() => useUpdateDocumentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'doc-1', spaceId: 'space-1', payload: {} });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.documents('space-1'));
    queryClient.clear();
  });

  it('useDeleteDocumentMutation invalidates the owning space document list and the spaces list', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockDeleteKnowledgeDocument.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteDocumentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'doc-1', spaceId: 'space-1' });
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.documents('space-1'));
    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.spaces);
    queryClient.clear();
  });

  it('useReindexSpaceMutation invalidates the space document list, whose embedded flags change', async () => {
    const queryClient = makeQueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    mockReindexKnowledgeSpace.mockResolvedValue({ reindexed: 2, skipped: [] });
    const { result } = renderHook(() => useReindexSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('space-1');
    });

    expect(invalidateQueries).toHaveBeenCalledWith(knowledgeKeys.documents('space-1'));
    queryClient.clear();
  });

  it('useReindexSpaceMutation shows a plain success toast when nothing was skipped', async () => {
    const queryClient = makeQueryClient();
    mockReindexKnowledgeSpace.mockResolvedValue({ reindexed: 3, skipped: [] });
    const { result } = renderHook(() => useReindexSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('space-1');
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_admin_toast_knowledge_space_reindexed',
      status: 'success',
    });
    queryClient.clear();
  });

  it('useReindexSpaceMutation shows a warning toast, not a silent success, when documents were skipped', async () => {
    const queryClient = makeQueryClient();
    mockReindexKnowledgeSpace.mockResolvedValue({
      reindexed: 2,
      skipped: [{ title: 'Регламент', reason: 'Оригинал документа не сохранён' }],
    });
    const { result } = renderHook(() => useReindexSpaceMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('space-1');
    });

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_admin_toast_knowledge_space_reindexed_partial',
      status: 'warning',
    });
    queryClient.clear();
  });
});
