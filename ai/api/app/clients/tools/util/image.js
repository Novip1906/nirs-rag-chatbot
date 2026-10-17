const { createImageGenerationTool, guardToolArguments } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const db = require('~/models');

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createImageTool({ req, userId, config, requestFiles }) {
  const inputs = {
    requestFiles,
    findUserImages: async (fileIds) =>
      (await db.getFiles({ user: userId, file_id: { $in: fileIds } }, {}, { text: 0 })) ?? [],
    readFile: async (file) => {
      const source = file.source || req.config?.fileStrategy;
      const { getDownloadStream } = getStrategyFunctions(source);
      if (!getDownloadStream) {
        throw new Error(`No download stream for file source: ${source}`);
      }
      return streamToBuffer(await getDownloadStream(req, file.filepath));
    },
  };
  return guardToolArguments(
    createImageGenerationTool({
      userId,
      config,
      db: {
        getGlobalSettings: db.getGlobalSettings,
        getUserPolicy: db.getUserPolicy,
        getDepartmentById: db.getDepartmentById,
        getUsageTotals: db.getUsageTotals,
        recordUsage: db.recordUsage,
      },
      inputs,
    }),
    ['prompt'],
  );
}

module.exports = { createImageTool };
