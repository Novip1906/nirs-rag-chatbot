const path = require('path');
const mongoose = require('mongoose');
const { runAsSystem } = require('@librechat/data-schemas');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

/**
 * Месячный лимит убран из системы целиком (остаётся только суточный), а
 * `dailyRequests`/`monthlyRequests` — лимит по количеству запросов — был выключен ещё
 * раньше и с тех пор ни на что не влиял. Поля продолжали ездить по документам и путать,
 * хотя ни `ILimits`, ни валидация их больше не знают.
 *
 * Скрипт:
 *  1. `$unset` полей `monthlyCostUsd`/`dailyRequests`/`monthlyRequests` из
 *     `departments.defaultLimits` и из `userpolicies.limits`.
 *  2. Отменяет ещё не рассмотренные (`status: 'pending'`) заявки на повышение месячного
 *     лимита — их больше нечем одобрить, а молча удалять чужую заявку нельзя. Уже
 *     решённые (`approved`/`rejected`) заявки с `window: 'monthly'` не трогает — это
 *     история, а не работающая настройка, и поле `window` в схеме остаётся ради неё.
 *
 * Идемпотентен: `$unset` несуществующего поля — no-op, а второй проход не находит ни
 * одной оставшейся pending-заявки на месячный лимит.
 *
 * Usage: node config/migrate-remove-monthly-limits.js [--dry-run]
 */

const DEAD_LIMIT_FIELDS = ['monthlyCostUsd', 'dailyRequests', 'monthlyRequests'];

function unsetClause(prefix) {
  const unset = {};
  for (const field of DEAD_LIMIT_FIELDS) {
    unset[`${prefix}.${field}`] = '';
  }
  return unset;
}

function hasDeadField(prefix) {
  return { $or: DEAD_LIMIT_FIELDS.map((field) => ({ [`${prefix}.${field}`]: { $exists: true } })) };
}

async function unsetDeadLimitFields(db, dryRun) {
  const departmentsFilter = hasDeadField('defaultLimits');
  const userPoliciesFilter = hasDeadField('limits');

  const [departmentsCount, userPoliciesCount] = await Promise.all([
    db.collection('departments').countDocuments(departmentsFilter),
    db.collection('userpolicies').countDocuments(userPoliciesFilter),
  ]);

  console.purple(`Отделов с устаревшими полями лимитов: ${departmentsCount}`);
  console.purple(`Персональных политик с устаревшими полями лимитов: ${userPoliciesCount}`);

  if (dryRun) {
    return { departmentsCount, userPoliciesCount };
  }

  const [departmentsResult, userPoliciesResult] = await Promise.all([
    db
      .collection('departments')
      .updateMany(departmentsFilter, { $unset: unsetClause('defaultLimits') }),
    db.collection('userpolicies').updateMany(userPoliciesFilter, { $unset: unsetClause('limits') }),
  ]);

  console.green(`Отделов обновлено: ${departmentsResult.modifiedCount}`);
  console.green(`Персональных политик обновлено: ${userPoliciesResult.modifiedCount}`);

  return { departmentsCount, userPoliciesCount };
}

async function cancelPendingMonthlyRequests(db, dryRun) {
  const filter = { window: 'monthly', status: 'pending' };
  const pendingCount = await db.collection('limitrequests').countDocuments(filter);

  console.purple(`Незакрытых заявок на месячный лимит: ${pendingCount}`);

  if (dryRun || pendingCount === 0) {
    return pendingCount;
  }

  const result = await db.collection('limitrequests').updateMany(filter, {
    $set: {
      status: 'rejected',
      resolvedAt: new Date(),
    },
    // `resolvedBy` остаётся `null` — заявку отклонила не конкретная учётная запись,
    // а сама миграция: месячного лимита, который она просила, больше не существует.
  });

  console.green(`Заявок на месячный лимит отклонено автоматически: ${result.modifiedCount}`);
  return pendingCount;
}

(async () => {
  await connect();

  console.purple('--------------------------');
  console.purple('Удаление месячного лимита и мёртвых полей лимитов');
  console.purple('--------------------------');

  const dryRun = process.argv.includes('--dry-run');
  const db = mongoose.connection.db;

  await runAsSystem(async () => {
    const { departmentsCount, userPoliciesCount } = await unsetDeadLimitFields(db, dryRun);
    const pendingMonthlyCount = await cancelPendingMonthlyRequests(db, dryRun);

    if (dryRun) {
      console.orange('Dry run — в базу ничего не записано.');
      return;
    }

    if (departmentsCount === 0 && userPoliciesCount === 0 && pendingMonthlyCount === 0) {
      console.green('Нечего мигрировать.');
      return;
    }

    console.green('Готово.');
  });

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
