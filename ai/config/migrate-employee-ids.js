const path = require('path');
const mongoose = require('mongoose');
const { backfillEmployeeIds } = require('@librechat/data-schemas');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

(async () => {
  await connect();

  console.purple('--------------------------');
  console.purple('Проставление employeeId сотрудникам');
  console.purple('--------------------------');

  const dryRun = process.argv.includes('--dry-run');
  const { scanned, updated } = await backfillEmployeeIds(mongoose.connection, { dryRun });

  if (dryRun) {
    console.yellow(`Без записи: без идентификатора ${scanned} сотрудник(ов).`);
  } else {
    console.green(`Просмотрено ${scanned}, проставлено ${updated}.`);
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
