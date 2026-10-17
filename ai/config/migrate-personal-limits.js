const path = require('path');
const mongoose = require('mongoose');
const { runAsSystem } = require('@librechat/data-schemas');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

const LIMIT_KEYS = ['dailyCostRub', 'dailyRequests', 'monthlyCostRub', 'monthlyRequests'];

/**
 * Персональные лимиты стали «всё или ничего»: раньше `null` в отдельном поле означал
 * «унаследовать от отдела», теперь — «без ограничения». Записи, где часть полей заполнена,
 * а часть оставлена пустой, поменяли бы смысл молча: сотрудник с личным дневным лимитом и
 * пустым месячным получил бы безлимитный месяц вместо лимита отдела.
 *
 * Скрипт дозаполняет пустые поля таких записей их сегодняшними эффективными значениями,
 * чтобы после смены семантики ничего не поехало. Политики без личных лимитов и политики,
 * где заполнены все четыре поля, не трогаются.
 *
 * Usage: npm run migrate:personal-limits [-- --dry-run]
 */
async function loadEffectiveLimits(db) {
  const settings = await db.collection('corporatesettings').findOne({ key: 'global' });
  const departments = await db
    .collection('departments')
    .find({}, { projection: { defaultLimits: 1 } })
    .toArray();

  const globalLimits = settings?.defaultLimits ?? {};
  const byDepartment = new Map(
    departments.map((department) => [department._id.toString(), department.defaultLimits ?? {}]),
  );

  return (departmentId) => {
    const departmentLimits = departmentId ? (byDepartment.get(departmentId.toString()) ?? {}) : {};
    const effective = {};
    for (const key of LIMIT_KEYS) {
      effective[key] = departmentLimits[key] ?? globalLimits[key] ?? null;
    }
    return effective;
  };
}

function findGaps(limits, effective) {
  const filled = {};
  for (const key of LIMIT_KEYS) {
    if (limits[key] == null && effective[key] != null) {
      filled[`limits.${key}`] = effective[key];
    }
  }
  return filled;
}

(async () => {
  await connect();

  console.purple('--------------------------');
  console.purple('Migrate personal spend limits');
  console.purple('--------------------------');

  const dryRun = process.argv.includes('--dry-run');
  const db = mongoose.connection.db;

  await runAsSystem(async () => {
    const resolveEffective = await loadEffectiveLimits(db);
    const policies = await db
      .collection('userpolicies')
      .find({ limits: { $ne: null } }, { projection: { limits: 1, departmentId: 1, userId: 1 } })
      .toArray();

    const pending = [];
    for (const policy of policies) {
      const gaps = findGaps(policy.limits ?? {}, resolveEffective(policy.departmentId));
      if (Object.keys(gaps).length > 0) {
        pending.push({ policy, gaps });
      }
    }

    console.purple(`Policies with personal limits: ${policies.length}`);
    console.purple(`Policies that would change meaning: ${pending.length}`);

    if (pending.length === 0) {
      console.green('Nothing to migrate.');
      return;
    }

    for (const { policy, gaps } of pending) {
      console.yellow(`  user ${policy.userId}: ${JSON.stringify(gaps)}`);
    }

    if (dryRun) {
      console.orange('Dry run — nothing was written.');
      return;
    }

    const confirm = await askQuestion('Apply these values? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      console.orange('Aborted.');
      return;
    }

    let migrated = 0;
    for (const { policy, gaps } of pending) {
      await db.collection('userpolicies').updateOne({ _id: policy._id }, { $set: gaps });
      migrated += 1;
    }

    console.green(`Migrated ${migrated} policy document(s).`);
  });

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
