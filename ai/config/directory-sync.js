const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
require('~/db/models');
const { runDirectorySync } = require('@librechat/api');
const { buildDirectorySyncDeps } = require('../api/server/services/directorySyncDeps');
const { silentExit } = require('./helpers');
const connect = require('./connect');

(async () => {
  await connect();

  console.purple('--------------------------');
  console.purple('Сверка справочника с сервисом сотрудников');
  console.purple('--------------------------');

  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'report';
  if (mode !== 'report' && mode !== 'apply') {
    console.red(`Error: unknown mode "${mode}" — use --mode=report or --mode=apply`);
    silentExit(1);
  }

  const report = await runDirectorySync(buildDirectorySyncDeps(), mode);

  const heldBack = report.aborted === 'too_many_changes';
  if (report.aborted && !heldBack) {
    console.red(`Прогон прерван: ${report.aborted}`);
    silentExit(1);
  }

  console.green(`Изменений: ${report.changes.length}`);
  report.changes.forEach((change) => console.yellow(`  ${JSON.stringify(change)}`));
  console.green(`Конфликтов: ${report.conflicts.length}`);
  report.conflicts.forEach((conflict) => console.yellow(`  ${JSON.stringify(conflict)}`));
  console.green(`Применено: ${report.applied ? 'да' : 'нет'}`);

  if (heldBack) {
    console.red(
      `Опасные изменения удержаны предохранителем (${report.heldBack}), остальные применены`,
    );
    silentExit(mode === 'apply' ? 2 : 0);
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
