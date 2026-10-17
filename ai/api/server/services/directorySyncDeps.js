const { runAsSystem } = require('@librechat/data-schemas');
const {
  createDirectoryClient,
  invalidateBlockedUser,
  normalizeOpenIdIssuer,
} = require('@librechat/api');
const {
  listDepartments,
  findUsers,
  listUserPolicies,
  updateUser,
  upsertUserPolicy,
  deleteAllUserSessions,
  updateDepartment,
  createDepartment,
  deleteDepartment,
  countDepartmentMembers,
  createUser,
} = require('~/models');

function buildDirectorySyncDeps(client = createDirectoryClient()) {
  return {
    client,
    issuer: normalizeOpenIdIssuer(process.env.OPENID_ISSUER) ?? '',
    runAsSystem,
    listDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    countDepartmentMembers,
    findUsers,
    createUser: (data) => createUser(data, undefined, true, true),
    updateUser,
    listUserPolicies,
    upsertUserPolicy,
    invalidateBlockedUser,
    deleteAllUserSessions,
  };
}

module.exports = { buildDirectorySyncDeps };
