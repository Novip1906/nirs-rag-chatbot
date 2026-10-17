const { logger, runAsSystem } = require('@librechat/data-schemas');
const {
  createDirectoryClient,
  syncDirectoryEmployee,
  syncDirectoryDepartment,
  tenantContextMiddleware,
} = require('@librechat/api');
const { SystemRoles } = require('librechat-data-provider');
const { getProcessVerifier, audienceIncludes } = require('~/server/services/oidcTokenVerifier');
const { ensureDepartment } = require('~/server/services/directoryEnsureDepartment');
const requireUnblocked = require('./requireUnblocked');

const USER_FIELDS = '-password -__v -totpSecret -backupCodes +agentTriggerDeletionStartedAt';

function readBearer(req) {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : undefined;
}

function createRequireAdminToken(options = {}) {
  let verifier = options.verify;
  let client = options.client;
  let syncDeps = options.syncDeps;
  const syncEmployee = options.syncEmployee || syncDirectoryEmployee;
  const syncDepartment = options.syncDepartment || syncDirectoryDepartment;
  const provisioning = new Map();
  const getMode = options.getMode || (() => process.env.ADMIN_API_SYNC_MODE);
  const getAudience = () => process.env.ADMIN_OIDC_AUDIENCE || 'corporate-ai';
  const getClientId = () => process.env.ADMIN_OIDC_CLIENT || 'admin';

  const getVerifier = () => verifier || getProcessVerifier();
  const getClient = () => (client = client || createDirectoryClient());
  const getSyncDeps = () => {
    if (!syncDeps) {
      const { buildDirectorySyncDeps } = require('~/server/services/directorySyncDeps');
      syncDeps = buildDirectorySyncDeps(getClient());
    }
    return syncDeps;
  };
  const findUser =
    options.findUser || ((criteria) => require('~/models').findUser(criteria, USER_FIELDS));

  const unauthorized = (res) => res.status(401).json({ message: 'Unauthorized' });

  async function findBySub(sub) {
    return runAsSystem(() => findUser({ openidId: sub }));
  }

  async function provisionOnce(sub) {
    if (
      String(getMode() || '')
        .trim()
        .toLowerCase() !== 'apply'
    ) {
      return { found: null };
    }
    const result = await getClient().getEmployeeBySub(sub);
    if (!result.ok) {
      return { found: null, unavailable: result.reason !== 'not_found' };
    }
    const employee = result.value;
    if (employee.department_id) {
      const ready = await ensureDepartment(
        { client: getClient(), syncDeps: getSyncDeps(), syncDepartment },
        employee.department_id,
      );
      if (!ready) {
        return { found: null, unavailable: true };
      }
    }
    await syncEmployee(getSyncDeps(), employee);
    return { found: await findBySub(sub) };
  }

  function provision(sub) {
    let pending = provisioning.get(sub);
    if (!pending) {
      pending = provisionOnce(sub).finally(() => provisioning.delete(sub));
      provisioning.set(sub, pending);
    }
    return pending;
  }

  return async function requireAdminToken(req, res, next) {
    try {
      const token = readBearer(req);
      if (!token) {
        return unauthorized(res);
      }

      const verify = getVerifier();
      if (!verify) {
        logger.error('[requireAdminToken] OPENID_ISSUER is not configured');
        return res.status(503).json({ message: 'Проверка токена не настроена' });
      }

      let claims;
      try {
        claims = await verify(token);
      } catch (error) {
        if (error && error.reason === 'unavailable') {
          logger.warn('[requireAdminToken] token verification is unavailable');
          return res.status(503).json({ message: 'Проверка токена временно недоступна' });
        }
        return unauthorized(res);
      }

      if (
        !claims ||
        typeof claims.sub !== 'string' ||
        claims.sub === '' ||
        claims.azp !== getClientId() ||
        !audienceIncludes(claims.aud, getAudience())
      ) {
        return unauthorized(res);
      }

      let user = await findBySub(claims.sub);
      if (!user) {
        const provisioned = await provision(claims.sub);
        if (provisioned.unavailable) {
          return res.status(503).json({ message: 'Сервис сотрудников временно недоступен' });
        }
        user = provisioned.found;
      }
      if (!user || user.agentTriggerDeletionStartedAt != null) {
        return unauthorized(res);
      }

      user.id = user._id.toString();
      user.idOnTheSource ??= null;
      if (!user.role) {
        user.role = SystemRoles.USER;
      }
      req.user = user;
      req.authStrategy = 'adminToken';

      tenantContextMiddleware(req, res, (tenantErr) => {
        if (tenantErr) {
          return next(tenantErr);
        }
        requireUnblocked(req, res, next).catch(next);
      });
    } catch (error) {
      logger.error('[requireAdminToken] unexpected error', error);
      return next(error);
    }
  };
}

const requireAdminToken = createRequireAdminToken();
module.exports = requireAdminToken;
module.exports.createRequireAdminToken = createRequireAdminToken;
