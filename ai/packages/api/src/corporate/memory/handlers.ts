import { logger } from '@librechat/data-schemas';
import type {
  TMemoryCompaction,
  TRevertMemoryRequest,
  TCompactMemoriesRequest,
  TUndoMemoryCompactionRequest,
} from 'librechat-data-provider';
import type { MemoryMethods, MemorySnapshotMethods } from '@librechat/data-schemas';
import type { RequestHandler, Response } from 'express';
import type { CompactionDeps } from './compaction';
import type { ServerRequest } from '~/types/http';
import { compactMemoryPartition, restoreMemorySnapshot } from './compaction';
import { getSafeErrorMetadata } from '~/utils/errors';
import Tokenizer from '~/utils/tokenizer';

export interface MemoryV2HandlerDeps extends CompactionDeps {
  revertMemory: MemoryMethods['revertMemory'];
  getRecentMemorySnapshots: MemorySnapshotMethods['getRecentMemorySnapshots'];
}

export interface MemoryV2Handlers {
  revert: RequestHandler;
  compact: RequestHandler;
  undoCompaction: RequestHandler;
  listCompactions: (userId: string) => Promise<TMemoryCompaction[]>;
}

type RevertPrevious = TRevertMemoryRequest['previous'];

const COMPACTIONS_WINDOW_MS = 24 * 60 * 60 * 1000;

function readPartitionId(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : undefined;
}

function readPrevious(value: unknown): RevertPrevious | undefined {
  if (value === null) {
    return null;
  }
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const { value: previousValue, title } = value as { value?: unknown; title?: unknown };
  if (typeof previousValue !== 'string' || (title != null && typeof title !== 'string')) {
    return undefined;
  }
  return { value: previousValue, ...(typeof title === 'string' ? { title } : {}) };
}

function requireUserId(req: ServerRequest, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized.' });
    return null;
  }
  return userId;
}

export function createMemoryV2Handlers(deps: MemoryV2HandlerDeps): MemoryV2Handlers {
  const revert: RequestHandler = async (req, res) => {
    const request = req as ServerRequest;
    const userId = requireUserId(request, res);
    if (userId == null) {
      return;
    }
    const body = (request.body ?? {}) as Partial<TRevertMemoryRequest>;
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) {
      res.status(400).json({ error: 'Key is required.' });
      return;
    }
    if (typeof body.expectedValue !== 'string') {
      res.status(400).json({ error: 'Expected value is required and must be a string.' });
      return;
    }
    const previous = readPrevious(body.previous);
    if (previous === undefined) {
      res.status(400).json({ error: 'Previous must be null or an object with a string value.' });
      return;
    }

    try {
      if (previous != null) {
        await Tokenizer.initEncoding('o200k_base');
      }
      const result = await deps.revertMemory({
        userId,
        key,
        agentId: readPartitionId(body.agentId),
        chatProjectId: readPartitionId(body.chatProjectId),
        expectedValue: body.expectedValue,
        previous:
          previous == null
            ? null
            : { ...previous, tokenCount: Tokenizer.getTokenCount(previous.value, 'o200k_base') },
      });
      if (result.ok) {
        res.status(200).json({ reverted: true });
        return;
      }
      if (result.reason === 'changed') {
        res.status(409).json({ error: 'Memory has changed since this write.' });
        return;
      }
      if (result.reason === 'not_found') {
        res.status(404).json({ error: 'Memory not found.' });
        return;
      }
      if (result.reason === 'invalid_project') {
        res.status(400).json({ error: 'Invalid chat project.' });
        return;
      }
      res.status(500).json({ error: 'Failed to revert memory.' });
    } catch (error) {
      logger.error('[memoryV2] Failed to revert memory', getSafeErrorMetadata(error));
      res.status(500).json({ error: 'Failed to revert memory.' });
    }
  };

  const compact: RequestHandler = async (req, res) => {
    const request = req as ServerRequest;
    const userId = requireUserId(request, res);
    if (userId == null) {
      return;
    }
    const appConfig = request.config;
    if (appConfig == null) {
      res.status(500).json({ error: 'Failed to compact memories.' });
      return;
    }
    const body = (request.body ?? {}) as Partial<TCompactMemoriesRequest>;

    try {
      const outcome = await compactMemoryPartition(deps, {
        appConfig,
        userId,
        userName: request.user?.name,
        agentId: readPartitionId(body.agentId),
        chatProjectId: readPartitionId(body.chatProjectId),
        reason: 'manual',
        charLimit: appConfig.memory?.charLimit,
      });
      res.status(outcome.reason === 'busy' ? 409 : 200).json(outcome);
    } catch (error) {
      logger.error('[memoryV2] Failed to compact memories', getSafeErrorMetadata(error));
      res.status(500).json({ error: 'Failed to compact memories.' });
    }
  };

  const undoCompaction: RequestHandler = async (req, res) => {
    const request = req as ServerRequest;
    const userId = requireUserId(request, res);
    if (userId == null) {
      return;
    }
    const body = (request.body ?? {}) as Partial<TUndoMemoryCompactionRequest>;
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    if (!snapshotId) {
      res.status(400).json({ error: 'Snapshot id is required.' });
      return;
    }

    try {
      const result = await restoreMemorySnapshot(deps, { userId, snapshotId });
      if (!result.restored) {
        res.status(404).json({ error: 'Compaction snapshot not found.' });
        return;
      }
      res.status(200).json({ restored: true, count: result.count });
    } catch (error) {
      logger.error('[memoryV2] Failed to undo memory compaction', getSafeErrorMetadata(error));
      res.status(500).json({ error: 'Failed to undo memory compaction.' });
    }
  };

  async function listCompactions(userId: string): Promise<TMemoryCompaction[]> {
    try {
      const snapshots = await deps.getRecentMemorySnapshots({
        userId,
        since: new Date(Date.now() - COMPACTIONS_WINDOW_MS),
      });
      return snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        agentId: snapshot.agentId ?? null,
        chatProjectId: snapshot.chatProjectId ?? null,
        before: snapshot.before,
        after: snapshot.after,
        reason: snapshot.reason,
        createdAt: snapshot.createdAt.toISOString(),
      }));
    } catch (error) {
      logger.error('[memoryV2] Failed to list memory compactions', getSafeErrorMetadata(error));
      return [];
    }
  }

  return { revert, compact, undoCompaction, listCompactions };
}
