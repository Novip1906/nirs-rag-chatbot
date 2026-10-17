import axios from 'axios';
import { dataService as _dataService } from 'librechat-data-provider';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getMemories', () => {
  it('should fetch memories from /api/memories', async () => {
    const mockData = [{ key: 'foo', value: 'bar', updated_at: '2024-05-01T00:00:00Z' }];

    mockedAxios.get.mockResolvedValueOnce({ data: mockData } as any);

    const result = await (_dataService as any).getMemories();

    expect(mockedAxios.get).toHaveBeenCalledWith('/api/memories', expect.any(Object));
    expect(result).toEqual(mockData);
  });
});

describe('opaque memory management', () => {
  it('deletes a projected memory through its encoded id and agent partition', async () => {
    mockedAxios.delete.mockResolvedValueOnce({ data: { deleted: true } });

    await _dataService.deleteMemoryById('memory/id', 'agent id');

    expect(mockedAxios.delete).toHaveBeenCalledWith(
      '/api/memories/id/memory%2Fid?agentId=agent%20id',
    );
  });

  it('updates a projected memory without sending its hidden key', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ data: { updated: true } });

    await _dataService.updateMemoryById('memory-id', 'replacement value', undefined, 'agent-id');

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/memories/id/memory-id?agentId=agent-id',
      JSON.stringify({ value: 'replacement value' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('sends an explicit replacement key only when supplied', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ data: { updated: true } });

    await _dataService.updateMemoryById('memory-id', 'replacement value', 'replacement_key');

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/memories/id/memory-id',
      JSON.stringify({ value: 'replacement value', key: 'replacement_key' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
});

describe('memory revert and compaction', () => {
  it('reverts a memory to its previous value', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { reverted: true } });

    await _dataService.revertMemory({
      key: 'context',
      agentId: 'agent-id',
      expectedValue: 'new value',
      previous: { value: 'old value', title: 'Old title' },
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/memories/revert',
      JSON.stringify({
        key: 'context',
        agentId: 'agent-id',
        expectedValue: 'new value',
        previous: { value: 'old value', title: 'Old title' },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('reverts a created record with a null previous value', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { reverted: true } });

    await _dataService.revertMemory({
      key: 'context',
      expectedValue: 'brand new',
      previous: null,
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/memories/revert',
      JSON.stringify({ key: 'context', expectedValue: 'brand new', previous: null }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('compacts a memory partition', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        compacted: true,
        before: 10,
        after: 6,
        beforeTokens: 500,
        afterTokens: 300,
        snapshotId: 'snap-1',
      },
    });

    await _dataService.compactMemories({ chatProjectId: 'project-1' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/memories/compact',
      JSON.stringify({ chatProjectId: 'project-1' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('undoes a memory compaction', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { restored: true, count: 6 } });

    await _dataService.undoMemoryCompaction({ snapshotId: 'snap-1' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/memories/compact/undo',
      JSON.stringify({ snapshotId: 'snap-1' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
});

describe('memory titles', () => {
  it('creates a memory by title without sending a key', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { created: true, memory: { title: 'My title', value: 'bar' } },
    });

    await _dataService.createMemory({ title: 'My title', value: 'bar' });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/memories',
      JSON.stringify({ title: 'My title', value: 'bar' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('sends a title when updating a memory by key', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ data: { updated: true } });

    await _dataService.updateMemory(
      'context',
      'new value',
      undefined,
      undefined,
      undefined,
      'New title',
    );

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/memories/context',
      JSON.stringify({ key: 'context', value: 'new value', title: 'New title' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('sends a title when updating a memory by opaque id', async () => {
    mockedAxios.patch.mockResolvedValueOnce({ data: { updated: true } });

    await _dataService.updateMemoryById(
      'memory-id',
      'new value',
      undefined,
      undefined,
      undefined,
      'New title',
    );

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/memories/id/memory-id',
      JSON.stringify({ value: 'new value', title: 'New title' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
});
