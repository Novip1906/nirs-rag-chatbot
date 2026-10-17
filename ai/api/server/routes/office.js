const fs = require('fs');
const express = require('express');
const {
  createCorporateUsersHandlers,
  createCorporateDepartmentsHandlers,
  createCorporateSettingsHandlers,
  createCorporateLimitRequestsHandlers,
  createCorporateSpendHandlers,
  createCorporateAnalyticsHandlers,
  createCorporateBalanceHandlers,
  createCorporateActivityHandlers,
  createCorporateFeedbackHandlers,
  createCorporateUsageHandlers,
  createCorporateModelsHandlers,
  corporateModelCatalog,
  createCorporateKnowledgeHandlers,
  createCorporateCapabilitiesHandlers,
  createKnowledgeDocumentHandlers,
  createEmployeeKnowledgeHandlers,
  getAppConfigOptionsFromUser,
  generateShortLivedToken,
  extractText: ragExtractText,
  embedDocument: ragEmbedDocument,
  deleteDocuments: ragDeleteDocuments,
  saveOriginalToDisk,
  removeOriginalFromDisk,
  isObjectStorageConfigured,
  saveOriginalToObjectStorage,
  readOriginalFromObjectStorage,
  removeOriginalFromObjectStorage,
  resolvePolicy,
  toResolvePolicyDeps,
  resolveAllowedSpaces,
  resolveWritableSpaces,
  ingestDocument,
  getKnowledgeRagUrl,
  getCachedPrincipals,
} = require('@librechat/api');
const { SystemCapabilities, logger } = require('@librechat/data-schemas');
const { SystemRoles, FileContext } = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const requireAdminToken = require('~/server/middleware/requireAdminToken');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { loadConfigModels } = require('~/server/services/Config');
const { getAppConfig } = require('~/server/services/Config/app');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { knowledgeUpload, KNOWLEDGE_UPLOADS_ROOT } = require('./office.knowledgeMulter');
const db = require('~/models');

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
/**
 * Три capability главы (`manage:knowledge_documents`, `manage:department_members`,
 * `manage:limit_requests`) до сих пор проверялись только фактом входа в админку и
 * набором главы, а маршруты решали «что можно» одной ролью — снять грант, не трогая
 * код, было нельзя. Middleware дополняет сужение по отделу (`departmentScope`), а не
 * заменяет его: сначала «есть ли право вообще», потом обработчик решает «над кем».
 * Админ и владелец получают все три сидингом (`seedSystemGrants`), так что для них
 * ничего не меняется.
 */
const requireManageKnowledgeDocuments = requireCapability(
  SystemCapabilities.MANAGE_KNOWLEDGE_DOCUMENTS,
);
const requireManageDepartmentMembers = requireCapability(
  SystemCapabilities.MANAGE_DEPARTMENT_MEMBERS,
);
const requireManageLimitRequests = requireCapability(SystemCapabilities.MANAGE_LIMIT_REQUESTS);

const isObjectStoragePath = (storagePath) => storagePath.startsWith('s3://');

/**
 * Общая для админского роутера базы знаний (`knowledgeIngestDeps`) и права доступа
 * сотрудника (`knowledgeAccessDeps` ниже) — второй копии этого чтения быть не должно,
 * иначе они естественно разойдутся, как уже произошло с проверкой `deniedSpaces` в
 * `assertSpaceInScope`.
 */
const getKnowledgeSpaceOverrides = (id) =>
  db.getUserPolicy(id).then((policy) => ({
    allowedSpaces: (policy?.allowedSpaces ?? []).map((spaceId) => spaceId.toString()),
    deniedSpaces: (policy?.deniedSpaces ?? []).map((spaceId) => spaceId.toString()),
  }));

const admin = express.Router();
/**
 * `checkAdmin` сюда не ставится: он сверяется с `ADMIN_LEVEL_ROLES`, куда глава отдела
 * намеренно не входит. Вход определяется capability `access:admin`, которую админ и
 * владелец получают сидингом, а глава — своим набором.
 */
admin.use(requireAdminToken, requireAdminAccess);

const usersHandlers = createCorporateUsersHandlers({
  findUser: db.findUser,
  updateUser: db.updateUser,
  listDepartments: db.listDepartments,
  getUserPolicy: db.getUserPolicy,
  listUserPolicies: db.listUserPolicies,
  listAdminUserPage: db.listAdminUserPage,
  getGlobalSettings: db.getGlobalSettings,
  getDepartmentById: db.getDepartmentById,
  getSpendSummary: db.getSpendSummary,
  upsertUserPolicy: db.upsertUserPolicy,
  listSpaces: db.listSpaces,
});

const capabilitiesHandlers = createCorporateCapabilitiesHandlers({
  getUserPrincipals: db.getUserPrincipals,
  getHeldCapabilities: db.getHeldCapabilities,
  getUserPolicy: db.getUserPolicy,
  getDepartmentById: db.getDepartmentById,
  getCachedPrincipals,
});

const departmentsHandlers = createCorporateDepartmentsHandlers({
  listDepartments: db.listDepartments,
  getDepartmentById: db.getDepartmentById,
  updateDepartment: db.updateDepartment,
});

const settingsHandlers = createCorporateSettingsHandlers({
  getGlobalSettings: db.getGlobalSettings,
  updateGlobalSettings: db.updateGlobalSettings,
});

const limitRequestsHandlers = createCorporateLimitRequestsHandlers({
  getLimitRequestById: db.getLimitRequestById,
  listLimitRequests: db.listLimitRequests,
  listLimitRequestsByUsers: db.listLimitRequestsByUsers,
  resolveLimitRequest: db.resolveLimitRequest,
  upsertUserPolicy: db.upsertUserPolicy,
  findUsers: db.findUsers,
  getUserPolicy: db.getUserPolicy,
  listUserPolicies: db.listUserPolicies,
  getDepartmentById: db.getDepartmentById,
  getGlobalSettings: db.getGlobalSettings,
});

async function sendGeneratedImage(req, res, fileId) {
  const [file] =
    (await db.getFiles({ file_id: fileId, context: FileContext.image_generation }, null, {
      text: 0,
    })) ?? [];
  if (!file) {
    return false;
  }
  if (!req.config) {
    req.config = await getAppConfig({ baseOnly: true });
  }
  const { getDownloadStream } = getStrategyFunctions(file.source);
  if (!getDownloadStream) {
    return false;
  }
  const stream = await getDownloadStream(req, file.filepath);
  stream.on('error', (error) => {
    logger.error('[office] Не удалось прочитать сгенерированную картинку', error);
    if (!res.headersSent) {
      res.status(404).end();
      return;
    }
    res.destroy(error);
  });
  res.setHeader('Content-Type', file.type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  stream.pipe(res);
  return true;
}

const spendHandlers = createCorporateSpendHandlers({
  listSpendRequests: db.listSpendRequests,
  getRequestTranscript: db.getRequestTranscript,
  getRequestImage: db.getRequestImage,
  sendImage: sendGeneratedImage,
  findUsers: db.findUsers,
  listDepartments: db.listDepartments,
  getUserPolicy: db.getUserPolicy,
});

const analyticsHandlers = createCorporateAnalyticsHandlers({
  getSpendSummary: db.getSpendSummary,
  getUserPolicy: db.getUserPolicy,
});

const balanceHandlers = createCorporateBalanceHandlers();

const activityHandlers = createCorporateActivityHandlers({
  getActivitySummary: db.getActivitySummary,
  getFeedbackSummary: db.getFeedbackSummary,
});

const feedbackHandlers = createCorporateFeedbackHandlers({
  listFeedback: db.listFeedback,
});

const modelsHandlers = createCorporateModelsHandlers({
  getModelCatalogSources: async (req) => {
    const [appConfig, modelsConfig, providerCatalog] = await Promise.all([
      getAppConfig(getAppConfigOptionsFromUser(req.user)),
      loadConfigModels(req),
      corporateModelCatalog.getCatalog(),
    ]);
    return { modelSpecs: appConfig?.modelSpecs, modelsConfig, providerCatalog };
  },
});

/**
 * Общий набор зависимостей приёма документа: используется и админской загрузкой
 * (`createCorporateKnowledgeHandlers`), и конвейером `ingestDocument`, вызываемым
 * из роутера сотрудника ниже. Один источник вместо двух копий одних и тех же
 * функций доступа к RAG и хранилищу.
 */
const knowledgeIngestDeps = {
  listSpaces: db.listSpaces,
  getSpaceById: db.getSpaceById,
  createSpace: db.createSpace,
  updateSpace: db.updateSpace,
  deleteSpace: db.deleteSpace,
  countDocumentsBySpace: db.countDocumentsBySpace,
  listDocuments: db.listDocuments,
  getDocumentById: db.getDocumentById,
  createDocument: db.createDocument,
  updateDocument: db.updateDocument,
  deleteDocument: db.deleteDocument,
  archiveDocument: db.archiveDocument,
  extractText: ({ fileId, filePath, filename, mimetype, userId }) =>
    ragExtractText({
      baseUrl: getKnowledgeRagUrl(),
      token: generateShortLivedToken(userId),
      fileId,
      filePath,
      filename,
      mimetype,
    }),
  /**
   * `text` не был в деструктуризации — `ragEmbedDocument` всегда получал `undefined`
   * вместо уже извлечённого текста и молча падал на `createReadStream(filePath)`.
   * Для локальных путей это работало (только теряло нормализацию PDF из
   * `normalizeForIndexing`), а для `s3://...` (оригиналы в MinIO) — ENOENT: обычное
   * файловое чтение не понимает префикс `s3://`, читать его нужно через S3-клиент,
   * как и остальные пути к объектному хранилищу в этом файле.
   */
  embedDocument: ({ fileId, entityId, filePath, filename, mimetype, text, userId }) =>
    ragEmbedDocument({
      baseUrl: getKnowledgeRagUrl(),
      token: generateShortLivedToken(userId),
      fileId,
      entityId,
      filePath,
      filename,
      mimetype,
      text,
    }),
  deleteVectors: ({ fileIds, entityId, userId }) =>
    ragDeleteDocuments({
      baseUrl: getKnowledgeRagUrl(),
      token: generateShortLivedToken(userId),
      fileIds,
      entityId,
    }),
  saveOriginal: (input) =>
    isObjectStorageConfigured()
      ? saveOriginalToObjectStorage(input)
      : saveOriginalToDisk({ uploadsRoot: KNOWLEDGE_UPLOADS_ROOT, ...input }),
  removeOriginal: (storagePath) =>
    storagePath && isObjectStoragePath(storagePath)
      ? removeOriginalFromObjectStorage(storagePath)
      : removeOriginalFromDisk(storagePath),
  /** Тот же выбор диск/S3, что и `readOriginal` у `createKnowledgeDocumentHandlers`
   *  ниже — нужен здесь для `reindexSpace`, когда у документа нет сохранённого текста
   *  и приходится читать оригинал заново. */
  readOriginal: (storagePath) =>
    isObjectStoragePath(storagePath)
      ? readOriginalFromObjectStorage(storagePath)
      : fs.promises.readFile(storagePath),
  recordUsage: db.recordUsage,
  getUserPolicy: db.getUserPolicy,
  findUsers: db.findUsers,
  getSpaceOverrides: getKnowledgeSpaceOverrides,
};

const knowledgeHandlers = createCorporateKnowledgeHandlers(knowledgeIngestDeps);

admin.get('/users', usersHandlers.listUsers);
admin.get('/me/capabilities', capabilitiesHandlers.getMyCapabilities);
admin.get('/users/:id', usersHandlers.getUser);
admin.patch('/users/:id/ai-role', usersHandlers.updateUserAiRole);
admin.patch('/users/:id', requireManageDepartmentMembers, usersHandlers.updateUser);

admin.get('/departments', departmentsHandlers.listDepartments);
admin.patch('/departments/:id', departmentsHandlers.updateDepartment);

admin.get('/settings', settingsHandlers.getSettings);
admin.put('/settings', settingsHandlers.updateSettings);

admin.get('/limit-requests', limitRequestsHandlers.listLimitRequests);
admin.post(
  '/limit-requests/:id/approve',
  requireManageLimitRequests,
  limitRequestsHandlers.approveLimitRequest,
);
admin.post(
  '/limit-requests/:id/reject',
  requireManageLimitRequests,
  limitRequestsHandlers.rejectLimitRequest,
);

admin.get('/spend', spendHandlers.listSpend);
admin.get('/spend/requests/:messageId/transcript', spendHandlers.getTranscript);
admin.get('/spend/requests/:messageId/images/:fileId', spendHandlers.getImage);
admin.get('/analytics', analyticsHandlers.getAnalytics);
admin.get('/provider-balance', balanceHandlers.getProviderBalance);
admin.get('/analytics/activity', activityHandlers.getActivity);
admin.get('/feedback', feedbackHandlers.listFeedback);
admin.get('/models', modelsHandlers.listModels);

admin.use('/knowledge', requireManageKnowledgeDocuments);
admin.get('/knowledge/spaces', knowledgeHandlers.listSpaces);
admin.post('/knowledge/spaces', knowledgeHandlers.createSpace);
admin.patch('/knowledge/spaces/:id', knowledgeHandlers.updateSpace);
admin.delete('/knowledge/spaces/:id', knowledgeHandlers.deleteSpace);
admin.get('/knowledge/spaces/:id/documents', knowledgeHandlers.listDocuments);
admin.post(
  '/knowledge/spaces/:id/documents',
  knowledgeUpload.single('file'),
  knowledgeHandlers.uploadDocument,
);
admin.post('/knowledge/spaces/:id/reindex', knowledgeHandlers.reindexSpace);
admin.patch('/knowledge/documents/:id', knowledgeHandlers.updateDocument);
admin.delete('/knowledge/documents/:id', knowledgeHandlers.deleteDocument);

// Ошибки multer (например, превышение лимита размера файла) иначе дошли бы до клиента
// как HTML-страница 500 по умолчанию от Express, а не как JSON с понятным сообщением.
admin.use((err, _req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

const usage = express.Router();
usage.use(requireJwtAuth);

const usageHandlers = createCorporateUsageHandlers({
  getUserPolicy: db.getUserPolicy,
  getGlobalSettings: db.getGlobalSettings,
  getDepartmentById: db.getDepartmentById,
  getUsageTotals: db.getUsageTotals,
  getPendingLimitRequests: db.getPendingLimitRequests,
  createLimitRequest: db.createLimitRequest,
});

usage.get('/me', usageHandlers.getMyUsage);
usage.post('/request-limit', usageHandlers.requestLimitIncrease);

/**
 * Тот же способ вычисления доступных пространств, что и у `knowledge_search` /
 * `knowledge_list` в `api/app/clients/tools/util/knowledge.js` — права на просмотр
 * документа обязаны совпадать с правами на его поиск.
 */
const knowledgeAccessDeps = {
  resolvePolicy: async (id) => {
    const [policy, user] = await Promise.all([
      resolvePolicy(toResolvePolicyDeps(db), id),
      db.findUser({ _id: id }, 'role'),
    ]);
    return {
      departmentId: policy.departmentId,
      blocked: policy.blocked,
      role: user?.role ?? SystemRoles.USER,
    };
  },
  listSpaces: () =>
    db.listSpaces().then((spaces) =>
      spaces.map((space) => ({
        id: space._id.toString(),
        name: space.name,
        allowedDepartments: (space.allowedDepartments ?? []).map((id) => id.toString()),
        enabled: space.enabled,
      })),
    ),
  getSpaceOverrides: getKnowledgeSpaceOverrides,
};

const knowledgeDocumentHandlers = createKnowledgeDocumentHandlers({
  findDocumentByFileId: (fileId) =>
    db.findDocumentByFileId(fileId).then((doc) =>
      doc == null
        ? null
        : {
            fileId: doc.file_id,
            spaceId: doc.spaceId.toString(),
            title: doc.title,
            filename: doc.filename,
            mimetype: doc.mimetype,
            bytes: doc.bytes,
            storagePath: doc.storagePath,
            text: doc.text,
          },
    ),
  resolveAllowedSpaces: (userId) => resolveAllowedSpaces(knowledgeAccessDeps, userId),
  readOriginal: (storagePath) =>
    isObjectStoragePath(storagePath)
      ? readOriginalFromObjectStorage(storagePath)
      : fs.promises.readFile(storagePath),
  uploadsRoot: KNOWLEDGE_UPLOADS_ROOT,
});

const knowledge = express.Router();
knowledge.use(requireJwtAuth);

knowledge.get('/documents/:fileId/preview', knowledgeDocumentHandlers.getDocumentPreview);
knowledge.get('/documents/:fileId/file', knowledgeDocumentHandlers.getDocumentFile);

/**
 * Право записи вычисляется отдельно от права чтения (`knowledgeAccessDeps` выше) и
 * требует роли и признака `canUploadKnowledge` — их не даёт `resolvePolicy`, поэтому
 * запрашиваются отдельно, одним параллельным запросом с политикой отдела.
 */
const knowledgeWriteAccessDeps = {
  resolveWritePolicy: async (id) => {
    const [policy, user] = await Promise.all([
      db.getUserPolicy(id),
      db.findUser({ _id: id }, 'role'),
    ]);
    const effective = await resolvePolicy(toResolvePolicyDeps(db), id);
    return {
      departmentId: effective.departmentId,
      blocked: effective.blocked,
      role: user?.role ?? SystemRoles.USER,
      canUploadKnowledge: policy?.canUploadKnowledge === true,
    };
  },
  listSpaces: knowledgeAccessDeps.listSpaces,
  getSpaceOverrides: knowledgeAccessDeps.getSpaceOverrides,
};

const employeeKnowledgeHandlers = createEmployeeKnowledgeHandlers({
  resolveAllowedSpaces: (userId) => resolveAllowedSpaces(knowledgeAccessDeps, userId),
  resolveWritableSpaces: (userId) => resolveWritableSpaces(knowledgeWriteAccessDeps, userId),
  listDocuments: db.listDocuments,
  getDocumentById: db.getDocumentById,
  updateDocument: db.updateDocument,
  archiveDocument: db.archiveDocument,
  deleteDocument: db.deleteDocument,
  deleteVectors: knowledgeIngestDeps.deleteVectors,
  removeOriginal: knowledgeIngestDeps.removeOriginal,
  getUserPolicy: db.getUserPolicy,
  getSpaceById: db.getSpaceById,
  createSpace: db.createSpace,
  updateSpace: db.updateSpace,
  deleteSpace: db.deleteSpace,
  // Владелец документа — не то, что прислал клиент (сотруднику это поле недоступно
  // вовсе), а имя загрузившего, разрешённое здесь по его userId.
  ingest: async (input) => {
    const uploader = await db.findUser({ _id: input.userId }, 'name');
    return ingestDocument(knowledgeIngestDeps, {
      ...input,
      fields: { ...input.fields, owner: uploader?.name ?? '' },
    });
  },
});

knowledge.get('/spaces', employeeKnowledgeHandlers.listSpaces);
knowledge.post('/spaces', employeeKnowledgeHandlers.createSpace);
knowledge.patch('/spaces/:id', employeeKnowledgeHandlers.updateSpace);
knowledge.delete('/spaces/:id', employeeKnowledgeHandlers.deleteSpace);
knowledge.get('/spaces/:id/documents', employeeKnowledgeHandlers.listDocuments);
knowledge.post(
  '/spaces/:id/documents',
  knowledgeUpload.single('file'),
  employeeKnowledgeHandlers.uploadDocument,
);
knowledge.patch('/documents/:id', employeeKnowledgeHandlers.updateDocument);
knowledge.post('/documents/:id/archive', employeeKnowledgeHandlers.archiveDocument);
knowledge.delete('/documents/:id', employeeKnowledgeHandlers.deleteDocument);

// Как и у admin-роутера: ошибка multer иначе дошла бы до клиента HTML-страницей 500.
knowledge.use((err, _req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

module.exports = { admin, usage, knowledge };
