const express = require('express');
const {
  createProjectHandlers,
  createProjectDocumentHandlers,
  purgeProjectDocuments,
  generateShortLivedToken,
  extractText: ragExtractText,
  embedDocument: ragEmbedDocument,
  deleteDocuments: ragDeleteDocuments,
  saveOriginalToDisk,
  removeOriginalFromDisk,
  countTokens,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { projectDocumentUpload, PROJECT_DOCUMENTS_ROOT } = require('./projects.documentMulter');
const { logger } = require('@librechat/data-schemas');
const db = require('~/models');

const router = express.Router();
const handlers = createProjectHandlers({
  listChatProjects: db.listChatProjects,
  createChatProject: db.createChatProject,
  getChatProject: db.getChatProject,
  updateChatProject: db.updateChatProject,
  deleteChatProject: db.deleteChatProject,
  assignConversationToProject: db.assignConversationToProject,
});

const deleteVectors = ({ fileIds, entityId, userId }) =>
  ragDeleteDocuments({
    baseUrl: process.env.RAG_API_URL,
    token: generateShortLivedToken(userId),
    fileIds,
    entityId,
  });

const documentHandlers = createProjectDocumentHandlers({
  getChatProject: db.getChatProject,
  listProjectDocuments: db.listProjectDocuments,
  getProjectDocument: db.getProjectDocument,
  countProjectDocuments: db.countProjectDocuments,
  sumProjectDocumentBytes: db.sumProjectDocumentBytes,
  createProjectDocument: db.createProjectDocument,
  markProjectDocumentEmbedded: db.markProjectDocumentEmbedded,
  deleteProjectDocument: db.deleteProjectDocument,
  extractText: ({ fileId, filePath, filename, mimetype, userId }) =>
    ragExtractText({
      baseUrl: process.env.RAG_API_URL,
      token: generateShortLivedToken(userId),
      fileId,
      filePath,
      filename,
      mimetype,
    }),
  embedDocument: ({ fileId, entityId, filePath, filename, mimetype, text, userId }) =>
    ragEmbedDocument({
      baseUrl: process.env.RAG_API_URL,
      token: generateShortLivedToken(userId),
      fileId,
      entityId,
      filePath,
      filename,
      mimetype,
      text,
    }),
  deleteVectors,
  saveOriginal: ({ projectId, ...input }) =>
    saveOriginalToDisk({ uploadsRoot: PROJECT_DOCUMENTS_ROOT, spaceId: projectId, ...input }),
  removeOriginal: removeOriginalFromDisk,
  countTokens,
  recordUsage: db.recordUsage,
});

const cleanupDeps = {
  listProjectDocumentsByProject: db.listProjectDocumentsByProject,
  deleteVectors,
  deleteProjectDocument: db.deleteProjectDocument,
  removeOriginal: removeOriginalFromDisk,
};

/**
 * Векторы снимаются раньше `deleteChatProject`: после удаления записи проекта
 * `file_id` документов брать уже неоткуда, и они остались бы в pgvector навсегда.
 * Если очистка упадёт, проект не удаляется — документы без проекта лучше, чем
 * векторы без владельца.
 */
async function deleteProjectWithDocuments(req, res, next) {
  const { projectId } = req.params;
  const owner = req.user?.id ?? req.user?._id?.toString() ?? '';

  const project = await db.getChatProject(owner, projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    await purgeProjectDocuments(cleanupDeps, { owner, projectId });
  } catch (error) {
    logger.error('[projects] Error purging project documents', error);
    return res.status(502).json({ error: 'Failed to remove project documents' });
  }

  return handlers.deleteProject(req, res, next);
}

router.use(requireJwtAuth);

router.get('/', handlers.listProjects);
router.post('/', handlers.createProject);
router.put('/conversations/:conversationId', handlers.assignConversationToProject);
router.get('/:id/documents', documentHandlers.listDocuments);
router.post(
  '/:id/documents',
  projectDocumentUpload.single('file'),
  documentHandlers.uploadDocument,
);
router.post('/documents/:fileId/reindex', documentHandlers.reindexDocument);
router.delete('/documents/:fileId', documentHandlers.deleteDocument);
router.get('/:projectId', handlers.getProject);
router.patch('/:projectId', handlers.updateProject);
router.delete('/:projectId', deleteProjectWithDocuments);

// Ошибки multer (например, превышение лимита размера файла) иначе дошли бы до клиента
// как HTML-страница 500 по умолчанию от Express, а не как JSON с понятным сообщением.
router.use((err, _req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

module.exports = router;
