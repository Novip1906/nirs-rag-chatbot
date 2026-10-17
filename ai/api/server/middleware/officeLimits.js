const { logger } = require('@librechat/data-schemas');
const { assertWithinLimits, resolvePolicy, toResolvePolicyDeps } = require('@librechat/api');
const { isEphemeralAgentId } = require('librechat-data-provider');
const denyRequest = require('./denyRequest');
const db = require('~/models');

/**
 * Machine-readable `type` values for Corporate AI denials, mirroring how `ViolationTypes`
 * (librechat-data-provider) tags client-recognizable error shapes. The client matches on
 * `type` to render a localized message instead of parsing the Russian fallback `message`.
 */
const CorporateViolationTypes = {
  LIMIT: 'corporate_limit',
  BLOCKED: 'corporate_blocked',
  MODEL_NOT_ALLOWED: 'corporate_model_not_allowed',
  CHECK_FAILED: 'corporate_check_failed',
};

const WINDOW_LABELS = {
  daily: 'дневной',
};

const KIND_LABELS = {
  cost: 'по стоимости',
  requests: 'по числу запросов',
};

function formatResetAt(resetAt) {
  if (!resetAt) {
    return 'в начале следующего периода';
  }
  return new Date(resetAt).toLocaleString('ru-RU', {
    timeZone: process.env.TZ || 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeLimitVerdict(verdict) {
  const windowLabel = WINDOW_LABELS[verdict.window] ?? verdict.window;
  const kindLabel = KIND_LABELS[verdict.kind] ?? verdict.kind;
  return `Исчерпан ${windowLabel} лимит (${kindLabel}). Обновится ${formatResetAt(verdict.resetAt)}.`;
}

/**
 * Structured denial body for a failed `assertWithinLimits` verdict. `blocked` (no
 * `window`) and an exhausted threshold are different situations for the user, so they
 * get different `type`s rather than one message string the client would have to parse.
 */
function limitVerdictErrorBody(verdict) {
  if (!verdict.window) {
    return {
      type: CorporateViolationTypes.BLOCKED,
      message: 'Доступ к Corporate AI для вашей учётной записи заблокирован администратором.',
    };
  }
  return {
    type: CorporateViolationTypes.LIMIT,
    window: verdict.window,
    kind: verdict.kind,
    used: verdict.used,
    limit: verdict.limit,
    resetAt: verdict.resetAt,
    message: describeLimitVerdict(verdict),
  };
}

function checkFailedErrorBody(message) {
  return { type: CorporateViolationTypes.CHECK_FAILED, message };
}

function modelNotAllowedErrorBody(model) {
  if (!model) {
    return {
      type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
      model: null,
      message: 'Не удалось определить модель запроса для проверки доступа в Corporate AI.',
    };
  }
  return {
    type: CorporateViolationTypes.MODEL_NOT_ALLOWED,
    model,
    message: `Модель «${model}» недоступна для вашей учётной записи в Corporate AI.`,
  };
}

/**
 * A saved agent's own `model`/`model_parameters.model` (from its DB document) is what
 * actually gets sent to the provider — client-supplied `model_parameters.model` on the
 * request body is not used for a saved agent (see `client.js`'s
 * `agent.model || agent.model_parameters.model`). Trusting the request body for a saved
 * `agent_id` would let a request name an allowed model next to an `agent_id` whose stored
 * model is disallowed, or simply omit the model to skip the check entirely. `cachedAgent`
 * lets the caller reuse `req.resolvedAddedAgent` (already fetched by
 * `checkAddedConvoAccess` upstream) instead of a second lookup.
 */
async function resolveAgentModel(agentId, cachedAgent) {
  const agent = cachedAgent ?? (await db.getAgent({ id: agentId }));
  return agent?.model || agent?.model_parameters?.model || undefined;
}

function resolveSlotModel(agentId, explicitModel, cachedAgent) {
  if (agentId && !isEphemeralAgentId(agentId)) {
    return resolveAgentModel(agentId, cachedAgent);
  }
  return Promise.resolve(explicitModel);
}

/**
 * Every model this turn will actually run: the primary agent/model, and — because
 * `addedConvo` starts a second, independent generation (`processAddedConvo`) — its model
 * too. Skipping `addedConvo` would leave a second, unchecked generation running for free.
 */
function collectRequestedModels(req, endpointOption) {
  const addedConvo = endpointOption?.addedConvo;
  const modelPromises = [
    resolveSlotModel(endpointOption?.agent_id, endpointOption?.model_parameters?.model),
  ];
  if (addedConvo) {
    modelPromises.push(
      resolveSlotModel(addedConvo.agent_id, addedConvo.model, req.resolvedAddedAgent),
    );
  }
  return Promise.all(modelPromises);
}

/**
 * An empty allow-list is the unconfigured default (`CorporateSettings`/`Department`
 * both default `allowedModels` to `[]`) — not "nothing is allowed". Treating it as a
 * denial locks out every user on a fresh install before an admin has touched the
 * settings screen. "Deny everyone" has its own explicit control (`blocked`), so an
 * empty list here means no restriction beyond whatever `librechat.yaml` exposes. Once
 * an admin sets a real, non-empty list, an undeterminable model still can't be
 * verified against it and must be denied.
 */
function isModelAllowed(model, allowedModels) {
  if (allowedModels.length === 0) {
    return true;
  }
  if (!model) {
    return false;
  }
  return allowedModels.includes(model);
}

/**
 * Enforces Corporate AI spend/request limits and model allow-listing before an agent turn
 * starts generating. Sits after `buildEndpointOption` so `req.body.endpointOption` is
 * already populated with the requested model. Any failure here — a thrown dependency or
 * a failed check — must deny the request; nothing here is allowed to fail open.
 */
const checkOfficeLimits = async (req, res, next) => {
  const userId = req.user?.id ?? req.user?._id;
  if (!userId) {
    return denyRequest(
      req,
      res,
      checkFailedErrorBody('Не удалось определить пользователя для проверки лимитов Corporate AI.'),
    );
  }

  const policyDeps = toResolvePolicyDeps(db);
  let cachedPolicy;
  const getPolicy = async () => {
    if (!cachedPolicy) {
      cachedPolicy = await resolvePolicy(policyDeps, userId);
    }
    return cachedPolicy;
  };

  let verdict;
  try {
    verdict = await assertWithinLimits(
      { getUsageTotals: db.getUsageTotals, resolvePolicy: getPolicy },
      userId,
    );
  } catch (error) {
    logger.error('[checkOfficeLimits] Failed to check Corporate AI limits', error);
    return denyRequest(
      req,
      res,
      checkFailedErrorBody(
        'Не удалось проверить лимиты Corporate AI. Попробуйте отправить сообщение ещё раз позже.',
      ),
    );
  }

  if (!verdict.allowed) {
    return denyRequest(req, res, limitVerdictErrorBody(verdict));
  }

  const endpointOption = req.body?.endpointOption;
  let policy;
  let requestedModels;
  try {
    [policy, requestedModels] = await Promise.all([
      getPolicy(),
      collectRequestedModels(req, endpointOption),
    ]);
  } catch (error) {
    logger.error('[checkOfficeLimits] Failed to resolve Corporate AI policy or models', error);
    return denyRequest(
      req,
      res,
      checkFailedErrorBody(
        'Не удалось проверить доступ к модели Corporate AI. Попробуйте отправить сообщение ещё раз позже.',
      ),
    );
  }

  const disallowedIndex = requestedModels.findIndex(
    (model) => !isModelAllowed(model, policy.allowedModels),
  );
  if (disallowedIndex !== -1) {
    return denyRequest(req, res, modelNotAllowedErrorBody(requestedModels[disallowedIndex]));
  }

  next();
};

module.exports = checkOfficeLimits;
module.exports.CorporateViolationTypes = CorporateViolationTypes;
