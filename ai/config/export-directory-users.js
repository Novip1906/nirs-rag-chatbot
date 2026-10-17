const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
require('~/db/models');
const { findUsers, listUserPolicies } = require('../api/models');
const connect = require('./connect');

console.log = (...args) => console.error(...args);

(async () => {
  await connect();

  const users = await findUsers({ openidId: { $exists: true, $nin: [null, ''] } }, [
    '_id',
    'openidId',
    'employeeId',
    'role',
  ]);
  const policies = await listUserPolicies(users.map((user) => user._id.toString()));

  const rows = users.map((user) => ({
    sub: user.openidId,
    employeeId: user.employeeId ?? null,
    role: user.role ?? 'USER',
    blocked: policies.get(user._id.toString())?.blocked === true,
  }));

  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`, () => process.exit(0));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
