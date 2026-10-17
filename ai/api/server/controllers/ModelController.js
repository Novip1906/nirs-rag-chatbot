const { logger } = require('@librechat/data-schemas');
const { resolvePolicy, toResolvePolicyDeps, filterModelsConfigForUser } = require('@librechat/api');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const db = require('~/models');

const getModelsConfig = (req) => loadModels(req);

async function loadModels(req) {
  const [defaultModelsConfig, customModelsConfig] = await Promise.all([
    loadDefaultModels(req),
    loadConfigModels(req),
  ]);
  return { ...defaultModelsConfig, ...customModelsConfig };
}

async function modelController(req, res) {
  try {
    const modelConfig = await loadModels(req);
    const filteredConfig = await filterModelsConfigForUser(
      { resolvePolicy: (userId) => resolvePolicy(toResolvePolicyDeps(db), userId) },
      req.user.id,
      modelConfig,
    );
    res.send(filteredConfig);
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { modelController, loadModels, getModelsConfig };
