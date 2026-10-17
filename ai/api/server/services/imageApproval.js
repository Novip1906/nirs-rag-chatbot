const { registerImageApprovalHook } = require('@librechat/api');
const db = require('~/models');

let unregister;

function registerImageApproval() {
  unregister?.();
  unregister = registerImageApprovalHook({
    getGlobalSettings: db.getGlobalSettings,
    getUserPolicy: db.getUserPolicy,
    getDepartmentById: db.getDepartmentById,
    getUsageTotals: db.getUsageTotals,
    recordUsage: db.recordUsage,
  });
}

module.exports = { registerImageApproval };
