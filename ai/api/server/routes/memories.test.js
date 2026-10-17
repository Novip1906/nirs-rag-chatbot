const express = require('express');
const request = require('supertest');

const mockGetAllUserMemories = jest.fn();
const mockProjectStoredMemories = jest.fn((memories) => memories);
const mockSetMemoryById = jest.fn();
const mockDeleteMemoryById = jest.fn();
const mockGetUserMemories = jest.fn();
const mockCreateMemory = jest.fn();
const mockSetMemory = jest.fn();
const mockDeleteMemory = jest.fn();
const mockListChatProjects = jest.fn();
const mockOpaqueUpdateById = jest.fn((_req, res) => res.status(202).json({ delegated: 'update' }));
const mockOpaqueDeleteById = jest.fn((_req, res) => res.status(202).json({ delegated: 'delete' }));
const mockRevert = jest.fn((_req, res) => res.status(200).json({ reverted: true }));
const mockCompact = jest.fn((_req, res) => res.status(200).json({ compacted: true }));
const mockUndoCompaction = jest.fn((_req, res) => res.status(200).json({ restored: true }));
const mockListCompactions = jest.fn(async () => []);
const mockCreateMemoryV2Handlers = jest.fn(() => ({
  revert: (...args) => mockRevert(...args),
  compact: (...args) => mockCompact(...args),
  undoCompaction: (...args) => mockUndoCompaction(...args),
  listCompactions: (...args) => mockListCompactions(...args),
}));
const mockBlockFilteredMemoryContent = jest.fn(() => false);
let mockFilters;

jest.mock('@librechat/api', () => ({
  Tokenizer: { getTokenCount: jest.fn(() => 1) },
  generateCheckAccess: jest.fn(() => (_req, _res, next) => next()),
  inspectContent: jest.fn(() => null),
  extractMemoryContent: jest.fn(() => []),
  blockFilteredMemoryContent: (...args) => mockBlockFilteredMemoryContent(...args),
  projectStoredMemories: (...args) => mockProjectStoredMemories(...args),
  createMemoryManagementHandlers: jest.fn(() => ({
    updateById: (...args) => mockOpaqueUpdateById(...args),
    deleteById: (...args) => mockOpaqueDeleteById(...args),
  })),
  createMemoryV2Handlers: (...args) => mockCreateMemoryV2Handlers(...args),
  contentFilterBlockResponse: jest.fn(),
  limiterCache: jest.fn(() => undefined),
}));

jest.mock('librechat-data-provider', () => ({
  PermissionTypes: { MEMORIES: 'MEMORIES' },
  Permissions: {
    USE: 'USE',
    READ: 'READ',
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    OPT_OUT: 'OPT_OUT',
  },
  ResourceType: { AGENT: 'agent' },
  PermissionBits: { VIEW: 1 },
}));

jest.mock('~/server/services/PermissionService', () => ({
  findAccessibleResources: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/models', () => ({
  getAllUserMemories: (...args) => mockGetAllUserMemories(...args),
  getUserMemories: (...args) => mockGetUserMemories(...args),
  toggleUserMemories: jest.fn(),
  getRoleByName: jest.fn(),
  createMemory: (...args) => mockCreateMemory(...args),
  deleteMemory: (...args) => mockDeleteMemory(...args),
  setMemory: (...args) => mockSetMemory(...args),
  setMemoryById: (...args) => mockSetMemoryById(...args),
  deleteMemoryById: (...args) => mockDeleteMemoryById(...args),
  getAgents: jest.fn(),
  listChatProjects: (...args) => mockListChatProjects(...args),
  revertMemory: jest.fn(),
  replacePartitionMemories: jest.fn(),
  createMemorySnapshot: jest.fn(),
  completeMemorySnapshot: jest.fn(),
  getMemorySnapshot: jest.fn(),
  deleteMemorySnapshot: jest.fn(),
  getRecentMemorySnapshots: jest.fn(),
  getGlobalSettings: jest.fn(),
  getUserPolicy: jest.fn(),
  getDepartmentById: jest.fn(),
  recordUsage: jest.fn(),
  recordAuditEntry: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'USER' };
    next();
  },
  configMiddleware: (req, _res, next) => {
    req.config = {
      filters: mockFilters,
      memory: { tokenLimit: 100, charLimit: 10000 },
    };
    next();
  },
  memoryCompactLimiter: jest.requireActual('~/server/middleware/limiters/memoryCompactLimiter')
    .memoryCompactLimiter,
}));

const models = require('~/models');
const { memoryCompactLimiter } = require('~/server/middleware');
const memoriesRouter = require('./memories');

const memoryV2Deps = mockCreateMemoryV2Handlers.mock.calls[0]?.[0];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/memories', memoriesRouter);
  return app;
};

describe('GET /api/memories content policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilters = {
      memories: {
        pii: {
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: 'PRIVATE' }],
        },
      },
    };
    mockProjectStoredMemories.mockImplementation((memories) => memories);
  });

  it('returns a marked raw-free projection when current policy blocks a stored memory', async () => {
    const secret = 'PRIVATE-STORED';
    const stored = [
      {
        _id: 'memory-1',
        userId: 'user-1',
        key: 'safe key',
        value: secret,
        tokenCount: 7,
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue(stored);
    mockProjectStoredMemories.mockReturnValue([
      {
        ...stored[0],
        value: '',
        contentFilterBlocked: true,
      },
    ]);

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    expect(mockProjectStoredMemories).toHaveBeenCalledWith(stored, mockFilters);
    expect(response.body.memories).toEqual([
      expect.objectContaining({
        _id: 'memory-1',
        key: 'safe key',
        value: '',
        contentFilterBlocked: true,
      }),
    ]);
    expect(response.body.totalTokens).toBe(7);
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it('preserves safe stored memories and their existing response metadata', async () => {
    const stored = [
      {
        _id: 'memory-safe',
        userId: 'user-1',
        key: 'timezone',
        value: 'UTC',
        tokenCount: 3,
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue(stored);

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    expect(response.body.memories).toEqual(stored);
    expect(response.body).toMatchObject({
      totalTokens: 3,
      tokenLimit: 100,
      charLimit: 10000,
      usagePercentage: 3,
    });
  });

  it('does not expose stored content through projection errors', async () => {
    const secret = 'PRIVATE-ERROR-CONTEXT';
    mockGetAllUserMemories.mockResolvedValue([{ key: 'safe key', value: secret }]);
    mockProjectStoredMemories.mockImplementationOnce(() => {
      throw new Error(`projection failed for ${secret}`);
    });

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to retrieve memories.' });
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });
});

describe('opaque memory management routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilters = {
      memories: {
        pii: {
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: 'PRIVATE' }],
        },
      },
    };
  });

  it('delegates id updates to the typed handler after request middleware', async () => {
    const response = await request(buildApp())
      .patch('/api/memories/id/507f1f77bcf86cd799439011?agentId=agent-1')
      .send({ value: 'safe replacement' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ delegated: 'update' });
    expect(mockOpaqueUpdateById).toHaveBeenCalledTimes(1);
    expect(mockOpaqueUpdateById.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        params: { id: '507f1f77bcf86cd799439011' },
        query: { agentId: 'agent-1' },
        body: { value: 'safe replacement' },
        user: { id: 'user-1', role: 'USER' },
        config: expect.objectContaining({ filters: mockFilters }),
      }),
    );
  });

  it('delegates id deletes to the typed handler', async () => {
    const response = await request(buildApp()).delete(
      '/api/memories/id/507f1f77bcf86cd799439011?agentId=agent-1',
    );

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ delegated: 'delete' });
    expect(mockOpaqueDeleteById).toHaveBeenCalledTimes(1);
    expect(mockOpaqueDeleteById.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        params: { id: '507f1f77bcf86cd799439011' },
        query: { agentId: 'agent-1' },
        user: { id: 'user-1', role: 'USER' },
      }),
    );
  });
});

describe('GET /api/memories chat project names', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilters = undefined;
    mockProjectStoredMemories.mockImplementation((memories) => memories);
  });

  it('resolves chatProjectName for project-partitioned memories', async () => {
    const stored = [
      {
        _id: 'memory-personal',
        userId: 'user-1',
        key: 'timezone',
        value: 'UTC',
        tokenCount: 3,
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        _id: 'memory-project',
        userId: 'user-1',
        key: 'project_note',
        value: 'roadmap',
        tokenCount: 5,
        chatProjectId: 'project-1',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue(stored);
    mockListChatProjects.mockResolvedValue({
      projects: [{ _id: 'project-1', name: 'Roadmap Project' }],
      nextCursor: null,
    });

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    const projectMemory = response.body.memories.find((m) => m._id === 'memory-project');
    const personalMemory = response.body.memories.find((m) => m._id === 'memory-personal');
    expect(projectMemory.chatProjectName).toBe('Roadmap Project');
    expect(personalMemory.chatProjectName).toBeUndefined();
  });

  it('returns memories without names when the project lookup fails', async () => {
    const stored = [
      {
        _id: 'memory-project',
        userId: 'user-1',
        key: 'project_note',
        value: 'roadmap',
        tokenCount: 5,
        chatProjectId: 'project-1',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue(stored);
    mockListChatProjects.mockRejectedValue(new Error('db down'));

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    expect(response.body.memories).toEqual([
      expect.objectContaining({ _id: 'memory-project', chatProjectId: 'project-1' }),
    ]);
    expect(response.body.memories[0].chatProjectName).toBeUndefined();
  });

  it('excludes project-partitioned memories from totalTokens', async () => {
    const stored = [
      {
        _id: 'memory-personal',
        userId: 'user-1',
        key: 'timezone',
        value: 'UTC',
        tokenCount: 3,
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        _id: 'memory-project',
        userId: 'user-1',
        key: 'project_note',
        value: 'roadmap',
        tokenCount: 5,
        chatProjectId: 'project-1',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue(stored);
    mockListChatProjects.mockResolvedValue({
      projects: [{ _id: 'project-1', name: 'Roadmap Project' }],
      nextCursor: null,
    });

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    expect(response.body.totalTokens).toBe(3);
  });
});

describe('memory partition routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilters = undefined;
    mockGetUserMemories.mockResolvedValue([]);
    mockCreateMemory.mockResolvedValue({ ok: true });
    mockSetMemory.mockResolvedValue({ ok: true });
    mockDeleteMemory.mockResolvedValue({ ok: true });
  });

  it('creates a memory in the project partition when chatProjectId is provided', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { key: 'project_note', value: 'roadmap', chatProjectId: 'project-1' },
      ]);

    const response = await request(buildApp())
      .post('/api/memories')
      .send({ key: 'project_note', value: 'roadmap', chatProjectId: 'project-1' });

    expect(response.status).toBe(201);
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: 'project-1' }),
    );
    expect(mockGetUserMemories).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: 'project-1' }),
    );
  });

  it('creates a memory in the personal pool when chatProjectId is omitted', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'personal_note', value: 'hello' }]);

    const response = await request(buildApp())
      .post('/api/memories')
      .send({ key: 'personal_note', value: 'hello' });

    expect(response.status).toBe(201);
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: undefined }),
    );
  });

  it('updates a memory in the project partition when chatProjectId is provided', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([{ key: 'project_note', value: 'old' }])
      .mockResolvedValueOnce([{ key: 'project_note', value: 'new value' }]);

    const response = await request(buildApp())
      .patch('/api/memories/project_note')
      .query({ chatProjectId: 'project-1' })
      .send({ value: 'new value' });

    expect(response.status).toBe(200);
    expect(mockSetMemory).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: 'project-1' }),
    );
  });

  it('updates a memory in the personal pool when chatProjectId is omitted', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([{ key: 'personal_note', value: 'old' }])
      .mockResolvedValueOnce([{ key: 'personal_note', value: 'new value' }]);

    const response = await request(buildApp())
      .patch('/api/memories/personal_note')
      .send({ value: 'new value' });

    expect(response.status).toBe(200);
    expect(mockSetMemory).toHaveBeenCalledWith(
      expect.objectContaining({ chatProjectId: undefined }),
    );
  });

  it('deletes a memory from the project partition when chatProjectId is provided', async () => {
    const response = await request(buildApp())
      .delete('/api/memories/project_note')
      .query({ chatProjectId: 'project-1' });

    expect(response.status).toBe(200);
    expect(mockDeleteMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'project_note', chatProjectId: 'project-1' }),
    );
  });

  it('deletes a memory from the personal pool when chatProjectId is omitted', async () => {
    const response = await request(buildApp()).delete('/api/memories/personal_note');

    expect(response.status).toBe(200);
    expect(mockDeleteMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'personal_note', chatProjectId: undefined }),
    );
  });

  it('creates a memory by title and returns the record under the generated key', async () => {
    mockCreateMemory.mockResolvedValueOnce({ ok: true, key: 'my_note' });
    mockGetUserMemories
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'my_note', value: 'remember this', title: 'My Note' }]);

    const response = await request(buildApp())
      .post('/api/memories')
      .send({ title: 'My Note', value: 'remember this' });

    expect(response.status).toBe(201);
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: undefined, title: 'My Note' }),
    );
    expect(response.body.memory).toEqual(
      expect.objectContaining({ key: 'my_note', title: 'My Note' }),
    );
  });

  it('rejects creating a memory without a key or a title', async () => {
    const response = await request(buildApp())
      .post('/api/memories')
      .send({ value: 'remember this' });

    expect(response.status).toBe(400);
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('passes a submitted title through when updating a memory by key', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([{ key: 'personal_note', value: 'old' }])
      .mockResolvedValueOnce([{ key: 'personal_note', value: 'new value', title: 'New Title' }]);

    const response = await request(buildApp())
      .patch('/api/memories/personal_note')
      .send({ value: 'new value', title: 'New Title' });

    expect(response.status).toBe(200);
    expect(mockSetMemory).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
  });

  it('falls back to the existing title when renaming a key without a title in the body', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([{ key: 'old_key', value: 'old', title: 'Existing Title' }])
      .mockResolvedValueOnce([{ key: 'new_key', value: 'new value', title: 'Existing Title' }]);
    mockCreateMemory.mockResolvedValueOnce({ ok: true, key: 'new_key' });

    const response = await request(buildApp())
      .patch('/api/memories/old_key')
      .send({ key: 'new_key', value: 'new value' });

    expect(response.status).toBe(200);
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'new_key', title: 'Existing Title' }),
    );
    expect(response.body.memory).toEqual(
      expect.objectContaining({ key: 'new_key', title: 'Existing Title' }),
    );
  });

  it('uses the submitted title over the existing one when renaming a key', async () => {
    mockGetUserMemories
      .mockResolvedValueOnce([{ key: 'old_key', value: 'old', title: 'Existing Title' }])
      .mockResolvedValueOnce([{ key: 'new_key', value: 'new value', title: 'New Title' }]);
    mockCreateMemory.mockResolvedValueOnce({ ok: true, key: 'new_key' });

    const response = await request(buildApp())
      .patch('/api/memories/old_key')
      .send({ key: 'new_key', value: 'new value', title: 'New Title' });

    expect(response.status).toBe(200);
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'new_key', title: 'New Title' }),
    );
  });
});

describe('memory v2 routes', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFilters = undefined;
    mockProjectStoredMemories.mockImplementation((memories) => memories);
    mockListCompactions.mockResolvedValue([]);
    await memoryCompactLimiter.resetKey('user-1');
  });

  it('builds the v2 handlers once from the model methods', () => {
    expect(memoryV2Deps).toBe(models);
  });

  it('delegates a revert to the v2 handler with the partition from the body', async () => {
    const body = {
      key: 'project_note',
      expectedValue: 'new value',
      previous: { value: 'old value', title: 'Old Title' },
      chatProjectId: 'project-1',
    };

    const response = await request(buildApp()).post('/api/memories/revert').send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reverted: true });
    expect(mockRevert).toHaveBeenCalledTimes(1);
    expect(mockRevert.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        body,
        user: { id: 'user-1', role: 'USER' },
        config: expect.objectContaining({ memory: { tokenLimit: 100, charLimit: 10000 } }),
      }),
    );
    expect(mockBlockFilteredMemoryContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        key: 'project_note',
        value: 'old value',
        title: 'Old Title',
      },
    );
  });

  it('passes a null previous straight to the handler', async () => {
    const response = await request(buildApp())
      .post('/api/memories/revert')
      .send({ key: 'new_note', expectedValue: 'written by the assistant', previous: null });

    expect(response.status).toBe(200);
    expect(mockBlockFilteredMemoryContent).not.toHaveBeenCalled();
    expect(mockRevert).toHaveBeenCalledTimes(1);
  });

  it('rejects a revert whose previous value exceeds the character limit', async () => {
    const response = await request(buildApp())
      .post('/api/memories/revert')
      .send({ key: 'note', expectedValue: 'current', previous: { value: 'x'.repeat(10001) } });

    expect(response.status).toBe(400);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  it('blocks a revert whose previous value fails the memory content policy', async () => {
    mockBlockFilteredMemoryContent.mockImplementationOnce((_req, res) => {
      res.status(400).json({ error: 'blocked' });
      return true;
    });

    const response = await request(buildApp())
      .post('/api/memories/revert')
      .send({ key: 'note', expectedValue: 'current', previous: { value: 'PRIVATE' } });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'blocked' });
    expect(mockRevert).not.toHaveBeenCalled();
  });

  it('delegates a compaction to the v2 handler with the request config', async () => {
    const response = await request(buildApp())
      .post('/api/memories/compact')
      .send({ chatProjectId: 'project-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ compacted: true });
    expect(mockCompact).toHaveBeenCalledTimes(1);
    expect(mockCompact.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        body: { chatProjectId: 'project-1' },
        config: expect.objectContaining({ memory: { tokenLimit: 100, charLimit: 10000 } }),
      }),
    );
  });

  it('allows five compactions per user in ten minutes', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post('/api/memories/compact').send({});
      expect(response.status).toBe(200);
    }

    const limited = await request(app).post('/api/memories/compact').send({});

    expect(limited.status).toBe(429);
    expect(mockCompact).toHaveBeenCalledTimes(5);
  });

  it('delegates a compaction undo to the v2 handler', async () => {
    const response = await request(buildApp())
      .post('/api/memories/compact/undo')
      .send({ snapshotId: 'snapshot-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ restored: true });
    expect(mockUndoCompaction).toHaveBeenCalledTimes(1);
    expect(mockUndoCompaction.mock.calls[0][0]).toEqual(
      expect.objectContaining({ body: { snapshotId: 'snapshot-1' } }),
    );
  });

  it('lists recent compactions alongside the memories', async () => {
    const compactions = [
      {
        snapshotId: 'snapshot-1',
        agentId: null,
        chatProjectId: null,
        before: 9,
        after: 4,
        reason: 'auto',
        createdAt: '2026-09-25T10:00:00.000Z',
      },
    ];
    mockGetAllUserMemories.mockResolvedValue([]);
    mockListCompactions.mockResolvedValue(compactions);

    const response = await request(buildApp()).get('/api/memories');

    expect(response.status).toBe(200);
    expect(mockListCompactions).toHaveBeenCalledWith('user-1');
    expect(response.body.compactions).toEqual(compactions);
  });
});
