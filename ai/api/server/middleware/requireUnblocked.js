const { isUserBlocked } = require('@librechat/api');

const BLOCKED_TYPE = 'corporate_blocked';
const BLOCKED_MESSAGE =
  'Доступ к Corporate AI для вашей учётной записи заблокирован администратором.';

/**
 * Заблокированному пользователю остаётся ровно то, что нужно экрану блокировки:
 * узнать собственный статус (`GET /api/user`) и выйти из аккаунта (`/api/auth/*`).
 * Всё остальное API закрыто, иначе блокировка держалась бы только на интерфейсе.
 */
const ALLOWED_PREFIXES = ['/api/auth/'];

const withoutQuery = (url) => {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
};

const isAllowlisted = (req) => {
  const path = withoutQuery(req.originalUrl ?? '');
  if (path === '/api/user' && req.method === 'GET') {
    return true;
  }
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
};

/**
 * Проверка живёт внутри `requireJwtAuth`, а тот не должен тянуть за собой модели,
 * кэш-сторы и цепочку отправки сообщений на этапе загрузки модуля — отсюда
 * отложенные `require`.
 */
const readUserPolicy = (userId) => require('~/models').getUserPolicy(userId);

const isChatTurn = (path) => path.startsWith('/api/agents/chat');

/**
 * Отказ в диалоге должен выглядеть как сообщение об ошибке в самом чате, а не как
 * оборванный запрос, поэтому здесь та же подача, что у лимитов Corporate AI.
 */
const denyChatTurn = (req, res) =>
  require('./denyRequest')(req, res, { type: BLOCKED_TYPE, message: BLOCKED_MESSAGE });

const requireUnblocked = async (req, res, next) => {
  const userId = req.user?.id ?? req.user?._id?.toString?.();
  if (!userId || isAllowlisted(req)) {
    return next();
  }

  const blocked = await isUserBlocked({ getUserPolicy: readUserPolicy }, userId);
  if (!blocked) {
    return next();
  }

  if (isChatTurn(withoutQuery(req.originalUrl ?? ''))) {
    return denyChatTurn(req, res);
  }

  return res.status(403).json({ type: BLOCKED_TYPE, message: BLOCKED_MESSAGE });
};

module.exports = requireUnblocked;
module.exports.BLOCKED_TYPE = BLOCKED_TYPE;
module.exports.BLOCKED_MESSAGE = BLOCKED_MESSAGE;
