const express = require('express');
const {
  Tokenizer,
  generateCheckAccess,
  blockFilteredMemoryContent,
  projectStoredMemories,
  createMemoryV2Handlers,
  createMemoryManagementHandlers,
} = require('@librechat/api');
const {
  PermissionTypes,
  PermissionBits,
  ResourceType,
  Permissions,
} = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const db = require('~/models');
const { requireJwtAuth, configMiddleware, memoryCompactLimiter } = require('~/server/middleware');

const {
  getAllUserMemories,
  getUserMemories,
  toggleUserMemories,
  getRoleByName,
  createMemory,
  deleteMemory,
  setMemory,
  setMemoryById,
  deleteMemoryById,
  getAgents,
  listChatProjects,
} = db;

const router = express.Router();

const memoryPayloadLimit = express.json({ limit: '100kb' });

const checkMemoryRead = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.READ],
  getRoleByName,
});
const checkMemoryCreate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.CREATE],
  getRoleByName,
});
const checkMemoryUpdate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName,
});
const checkMemoryDelete = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName,
});
const checkMemoryOptOut = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.OPT_OUT],
  getRoleByName,
});
const opaqueMemoryHandlers = createMemoryManagementHandlers({
  setMemoryById,
  deleteMemoryById,
  projectStoredMemories,
  countTokens: (value) => Tokenizer.getTokenCount(value, 'o200k_base'),
});
const memoryV2Handlers = createMemoryV2Handlers(db);

router.use(requireJwtAuth);

/** Normalizes the optional agent partition param; undefined = shared personal pool */
const getAgentIdParam = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Normalizes the optional chat project partition param; undefined = shared personal pool */
const getChatProjectIdParam = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** A refused write is the caller's fault, not the server's: a malformed key or a project
 *  that does not exist or belongs to someone else. Only an unexplained refusal is a 500. */
const refusalResponse = (res, result, fallback) => {
  if (result.reason === 'invalid_key') {
    return res
      .status(400)
      .json({ error: 'Key must only contain lowercase letters and underscores.' });
  }
  if (result.reason === 'invalid_project') {
    return res.status(400).json({ error: 'Unknown chat project.' });
  }
  return res.status(500).json({ error: fallback });
};

/** Resolves agent display names for agent-partitioned memories, restricted
 *  to agents the requester can VIEW — `agentId` is caller-supplied on write,
 *  so an unrestricted lookup would leak private agents' names. */
const withAgentNames = async (memories, user) => {
  const agentIds = [...new Set(memories.map((m) => m.agentId).filter(Boolean))];
  if (agentIds.length === 0) {
    return memories;
  }
  try {
    const accessibleIds = await findAccessibleResources({
      userId: user.id,
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.VIEW,
    });
    const agents = await getAgents({ id: { $in: agentIds }, _id: { $in: accessibleIds } });
    const namesById = new Map(agents.map((agent) => [agent.id, agent.name]));
    return memories.map((memory) =>
      memory.agentId
        ? { ...memory, agentName: namesById.get(memory.agentId) ?? undefined }
        : memory,
    );
  } catch (_error) {
    return memories;
  }
};

/** Resolves chat project display names for project-partitioned memories.
 *  Chat projects are personal to their owner, so scoping the lookup to the
 *  requester's own projects is sufficient access control on its own. */
const withProjectNames = async (memories, user) => {
  const projectIds = new Set(memories.map((m) => m.chatProjectId).filter(Boolean));
  if (projectIds.size === 0) {
    return memories;
  }
  try {
    const namesById = new Map();
    let cursor;
    do {
      const page = await listChatProjects(user.id, { cursor, limit: 100 });
      for (const project of page.projects) {
        const id = project._id.toString();
        if (projectIds.has(id)) {
          namesById.set(id, project.name);
        }
      }
      cursor = page.nextCursor;
    } while (cursor && namesById.size < projectIds.size);

    return memories.map((memory) =>
      memory.chatProjectId
        ? { ...memory, chatProjectName: namesById.get(memory.chatProjectId) ?? undefined }
        : memory,
    );
  } catch (_error) {
    return memories;
  }
};

/**
 * GET /memories
 * Returns all memories for the authenticated user, sorted by updated_at (newest first).
 * Also includes memory usage percentage based on token limit.
 */
router.get('/', checkMemoryRead, configMiddleware, async (req, res) => {
  try {
    const compactionsPromise = memoryV2Handlers.listCompactions(req.user.id);
    const memories = await getAllUserMemories(req.user.id);
    const projectedMemories = projectStoredMemories(memories, req.config?.filters);

    const memoriesWithAgentNames = await withAgentNames(projectedMemories, req.user);
    const memoriesWithNames = await withProjectNames(memoriesWithAgentNames, req.user);
    const sortedMemories = memoriesWithNames.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    /** Usage totals reflect the shared personal pool only — `tokenLimit`
     *  applies per partition, matching the inline tools' enforcement. */
    const totalTokens = memories.reduce((sum, memory) => {
      return sum + (memory.agentId || memory.chatProjectId ? 0 : memory.tokenCount || 0);
    }, 0);

    const appConfig = req.config;
    const memoryConfig = appConfig?.memory;
    const tokenLimit = memoryConfig?.tokenLimit;
    const charLimit = memoryConfig?.charLimit || 10000;

    let usagePercentage = null;
    if (tokenLimit && tokenLimit > 0) {
      usagePercentage = Math.min(100, Math.round((totalTokens / tokenLimit) * 100));
    }

    res.json({
      memories: sortedMemories,
      totalTokens,
      tokenLimit: tokenLimit || null,
      charLimit,
      usagePercentage,
      compactions: await compactionsPromise,
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to retrieve memories.' });
  }
});

router.post('/', memoryPayloadLimit, checkMemoryCreate, configMiddleware, async (req, res) => {
  const { value } = req.body;
  const submittedKey = req.body.key;
  const submittedTitle = req.body.title;
  const agentId = getAgentIdParam(req.body.agentId);
  const chatProjectId = getChatProjectIdParam(req.body.chatProjectId);

  if (submittedKey != null && typeof submittedKey !== 'string') {
    return res.status(400).json({ error: 'Key must be a non-empty string when provided.' });
  }

  if (submittedTitle != null && typeof submittedTitle !== 'string') {
    return res.status(400).json({ error: 'Title must be a string when provided.' });
  }

  const key = typeof submittedKey === 'string' ? submittedKey.trim() : undefined;
  const title = typeof submittedTitle === 'string' ? submittedTitle : undefined;

  if (!key && (!title || title.trim() === '')) {
    return res
      .status(400)
      .json({ error: 'Key or title is required and must be a non-empty string.' });
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return res.status(400).json({ error: 'Value is required and must be a non-empty string.' });
  }

  const appConfig = req.config;
  const memoryConfig = appConfig?.memory;
  const charLimit = memoryConfig?.charLimit || 10000;

  if (key && key.length > 1000) {
    return res.status(400).json({
      error: `Key exceeds maximum length of 1000 characters. Current length: ${key.length} characters.`,
    });
  }

  if (value.length > charLimit) {
    return res.status(400).json({
      error: `Value exceeds maximum length of ${charLimit} characters. Current length: ${value.length} characters.`,
    });
  }

  const normalizedMemory = {
    ...(key ? { key } : {}),
    value: value.trim(),
    ...(title ? { title } : {}),
  };
  if (blockFilteredMemoryContent(req, res, normalizedMemory)) {
    return;
  }

  try {
    const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');

    const memories = await getUserMemories({ userId: req.user.id, agentId, chatProjectId });

    const appConfig = req.config;
    const memoryConfig = appConfig?.memory;
    const tokenLimit = memoryConfig?.tokenLimit;

    if (tokenLimit) {
      const currentTotalTokens = memories.reduce(
        (sum, memory) => sum + (memory.tokenCount || 0),
        0,
      );
      if (currentTotalTokens + tokenCount > tokenLimit) {
        return res.status(400).json({
          error: `Adding this memory would exceed the token limit of ${tokenLimit}. Current usage: ${currentTotalTokens} tokens.`,
        });
      }
    }

    const result = await createMemory({
      userId: req.user.id,
      key,
      value: value.trim(),
      title,
      tokenCount,
      agentId,
      chatProjectId,
    });

    if (!result.ok) {
      return refusalResponse(res, result, 'Failed to create memory.');
    }

    const updatedMemories = await getUserMemories({ userId: req.user.id, agentId, chatProjectId });
    const newMemory = updatedMemories.find((m) => m.key === result.key);

    res.status(201).json({ created: true, memory: newMemory });
  } catch (error) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Memory with this key already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /memories/preferences
 * Updates the user's memory preferences (e.g., enabling/disabling memories).
 * Body: { memories: boolean }
 * Returns 200 and { updated: true, preferences: { memories: boolean } } when successful.
 */
router.patch('/preferences', checkMemoryOptOut, async (req, res) => {
  const { memories } = req.body;

  if (typeof memories !== 'boolean') {
    return res.status(400).json({ error: 'memories must be a boolean value.' });
  }

  try {
    const updatedUser = await toggleUserMemories(req.user.id, memories);

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      updated: true,
      preferences: {
        memories: updatedUser.personalization?.memories ?? true,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const checkRevertContent = (req, res, next) => {
  const previous = req.body?.previous;
  if (previous == null || typeof previous.value !== 'string') {
    return next();
  }
  const charLimit = req.config?.memory?.charLimit || 10000;
  if (previous.value.length > charLimit) {
    return res.status(400).json({
      error: `Value exceeds maximum length of ${charLimit} characters. Current length: ${previous.value.length} characters.`,
    });
  }
  const memory = {
    ...(typeof req.body.key === 'string' ? { key: req.body.key } : {}),
    value: previous.value,
    ...(typeof previous.title === 'string' && previous.title ? { title: previous.title } : {}),
  };
  if (blockFilteredMemoryContent(req, res, memory)) {
    return;
  }
  next();
};

router.post(
  '/revert',
  checkMemoryUpdate,
  configMiddleware,
  checkRevertContent,
  memoryV2Handlers.revert,
);
router.post(
  '/compact',
  checkMemoryUpdate,
  memoryCompactLimiter,
  configMiddleware,
  memoryV2Handlers.compact,
);
router.post('/compact/undo', checkMemoryUpdate, memoryV2Handlers.undoCompaction);

router.patch(
  '/id/:id',
  memoryPayloadLimit,
  checkMemoryUpdate,
  configMiddleware,
  opaqueMemoryHandlers.updateById,
);
router.delete('/id/:id', checkMemoryDelete, opaqueMemoryHandlers.deleteById);

router.patch('/:key', memoryPayloadLimit, checkMemoryUpdate, configMiddleware, async (req, res) => {
  const { key: urlKey } = req.params;
  const { key: bodyKey, value, title: bodyTitle } = req.body || {};
  const agentId = getAgentIdParam(req.query.agentId);
  const chatProjectId = getChatProjectIdParam(req.query.chatProjectId);

  if (typeof value !== 'string' || value.trim() === '') {
    return res.status(400).json({ error: 'Value is required and must be a non-empty string.' });
  }

  if (bodyTitle != null && typeof bodyTitle !== 'string') {
    return res.status(400).json({ error: 'Title must be a string when provided.' });
  }

  const title = typeof bodyTitle === 'string' ? bodyTitle : undefined;
  const newKey = bodyKey || urlKey;
  const appConfig = req.config;
  const memoryConfig = appConfig?.memory;
  const charLimit = memoryConfig?.charLimit || 10000;

  if (newKey.length > 1000) {
    return res.status(400).json({
      error: `Key exceeds maximum length of 1000 characters. Current length: ${newKey.length} characters.`,
    });
  }

  if (value.length > charLimit) {
    return res.status(400).json({
      error: `Value exceeds maximum length of ${charLimit} characters. Current length: ${value.length} characters.`,
    });
  }

  if (blockFilteredMemoryContent(req, res, { key: newKey, value, ...(title ? { title } : {}) })) {
    return;
  }

  try {
    const tokenCount = Tokenizer.getTokenCount(value, 'o200k_base');

    const memories = await getUserMemories({ userId: req.user.id, agentId, chatProjectId });
    const existingMemory = memories.find((m) => m.key === urlKey);

    if (!existingMemory) {
      return res.status(404).json({ error: 'Memory not found.' });
    }

    if (newKey !== urlKey) {
      const keyExists = memories.find((m) => m.key === newKey);
      if (keyExists) {
        return res.status(409).json({ error: 'Memory with this key already exists.' });
      }

      const createResult = await createMemory({
        userId: req.user.id,
        key: newKey,
        value,
        title: title !== undefined ? title : existingMemory.title,
        tokenCount,
        agentId,
        chatProjectId,
      });

      if (!createResult.ok) {
        return refusalResponse(res, createResult, 'Failed to create new memory.');
      }

      const deleteResult = await deleteMemory({
        userId: req.user.id,
        key: urlKey,
        agentId,
        chatProjectId,
      });
      if (!deleteResult.ok) {
        return res.status(500).json({ error: 'Failed to delete old memory.' });
      }
    } else {
      const result = await setMemory({
        userId: req.user.id,
        key: newKey,
        value,
        title,
        tokenCount,
        agentId,
        chatProjectId,
      });

      if (!result.ok) {
        return refusalResponse(res, result, 'Failed to update memory.');
      }
    }

    const updatedMemories = await getUserMemories({ userId: req.user.id, agentId, chatProjectId });
    const updatedMemory = updatedMemories.find((m) => m.key === newKey);

    res.json({ updated: true, memory: updatedMemory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /memories/:key
 * Deletes a memory entry for the authenticated user.
 * Returns 200 and { deleted: true } when successful.
 */
router.delete('/:key', checkMemoryDelete, async (req, res) => {
  const { key } = req.params;
  const agentId = getAgentIdParam(req.query.agentId);
  const chatProjectId = getChatProjectIdParam(req.query.chatProjectId);

  try {
    const result = await deleteMemory({ userId: req.user.id, key, agentId, chatProjectId });

    if (!result.ok) {
      return res.status(404).json({ error: 'Memory not found.' });
    }

    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
