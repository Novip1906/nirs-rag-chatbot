const path = require('path');
const { migrateKnowledgeFilesToObjectStorage } = require('@librechat/api');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');
const { KnowledgeDocument } = require('~/db/models');

(async () => {
  await connect();

  console.purple('--------------------------');
  console.purple('Перенос оригиналов документов базы знаний в объектное хранилище');
  console.purple('--------------------------');

  const dryRun = process.argv.includes('--dry-run');
  const result = await migrateKnowledgeFilesToObjectStorage(KnowledgeDocument, { dryRun });

  if (dryRun) {
    console.yellow(
      `Без записи: к переносу ${result.eligible} документ(ов); уже в хранилище ${result.alreadyMigrated}; не найдено на диске ${result.missing}.`,
    );
  } else {
    console.green(
      `Просмотрено ${result.scanned}, перенесено ${result.migrated}, уже было в хранилище ${result.alreadyMigrated}, не найдено на диске ${result.missing}.`,
    );
  }

  if (result.missing > 0) {
    console.orange(`Файлы, не найденные на диске (storagePath не обновлён, PVC не тронут):`);
    for (const { fileId, storagePath } of result.missingFiles) {
      console.orange(`  file_id ${fileId}: ${storagePath}`);
    }
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
