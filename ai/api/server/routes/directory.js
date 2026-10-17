const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  createDirectoryClient,
  syncDirectoryEmployee,
  syncDirectoryDepartment,
} = require('@librechat/api');
const { getProcessVerifier, audienceIncludes } = require('~/server/services/oidcTokenVerifier');
const { ensureDepartment } = require('~/server/services/directoryEnsureDepartment');
const { buildDirectorySyncDeps } = require('~/server/services/directorySyncDeps');

const NOTIFY_TYPES = new Set(['employee', 'department']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notifyClientId() {
  return process.env.ADMIN_API_NOTIFY_CLIENT || 'admin-api-notify';
}

function notifyAudience() {
  return process.env.ADMIN_API_NOTIFY_AUDIENCE || 'corporate-ai';
}

function readBearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

function createDirectoryRouter(options = {}) {
  const router = express.Router();
  let verifier = options.verify;
  let client = options.client;
  let syncDeps = options.syncDeps;

  const getVerifier = () => verifier || getProcessVerifier();
  const getClient = () => (client = client || createDirectoryClient());
  const getSyncDeps = () => (syncDeps = syncDeps || buildDirectorySyncDeps(getClient()));
  const syncEmployee = options.syncEmployee || syncDirectoryEmployee;
  const syncDepartment = options.syncDepartment || syncDirectoryDepartment;
  const getMode = options.getMode || (() => process.env.ADMIN_API_SYNC_MODE);

  router.post('/notify', async (req, res) => {
    const token = readBearer(req);
    if (!token) {
      return res.status(401).json({ error: 'Требуется токен сервиса' });
    }

    const verify = getVerifier();
    if (!verify) {
      logger.error('[directory] OPENID_ISSUER is not configured');
      return res.status(503).json({ error: 'Проверка токена не настроена' });
    }

    let claims;
    try {
      claims = await verify(token);
    } catch (error) {
      if (error && error.reason === 'unavailable') {
        logger.warn('[directory] token verification is unavailable');
        return res.status(502).json({ error: 'Проверка токена временно недоступна' });
      }
      return res.status(401).json({ error: 'Токен сервиса недействителен' });
    }
    if (
      !claims ||
      claims.azp !== notifyClientId() ||
      !audienceIncludes(claims.aud, notifyAudience())
    ) {
      return res.status(403).json({ error: 'Токен выдан другому клиенту' });
    }

    const { type, id } = req.body || {};
    if (!NOTIFY_TYPES.has(type) || typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: 'Неверное тело уведомления' });
    }

    if (
      String(getMode() || '')
        .trim()
        .toLowerCase() !== 'apply'
    ) {
      return res.status(204).end();
    }

    try {
      if (type === 'employee') {
        const result = await getClient().getEmployee(id);
        if (!result.ok) {
          if (result.reason === 'not_found') {
            logger.warn('[directory] notified employee was not found', { id });
            return res.status(204).end();
          }
          return res.status(502).json({ error: 'Сервис сотрудников недоступен' });
        }
        const employee = result.value;
        if (
          employee.department_id &&
          !(await ensureDepartment(
            { client: getClient(), syncDeps: getSyncDeps(), syncDepartment },
            employee.department_id,
          ))
        ) {
          return res.status(502).json({ error: 'Сервис сотрудников недоступен' });
        }
        await syncEmployee(getSyncDeps(), employee);
        return res.status(204).end();
      }

      const departments = await getClient().listDepartments();
      if (!departments.ok) {
        return res.status(502).json({ error: 'Сервис сотрудников недоступен' });
      }
      const department = departments.value.find((candidate) => candidate.id === id);
      if (!department) {
        logger.warn('[directory] notified department was not found', { id });
        return res.status(204).end();
      }
      await syncDepartment(getSyncDeps(), department);
      return res.status(204).end();
    } catch (error) {
      logger.error('[directory] failed to apply notification', { type, id, error });
      return res.status(500).json({ error: 'Не удалось применить уведомление' });
    }
  });

  return router;
}

const router = createDirectoryRouter();
router.createDirectoryRouter = createDirectoryRouter;

module.exports = router;
