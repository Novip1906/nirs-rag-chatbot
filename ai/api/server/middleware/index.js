const validatePasswordReset = require('./validatePasswordReset');
const setTwoFactorTempUser = require('./setTwoFactorTempUser');
const validateRegistration = require('./validateRegistration');
const buildEndpointOption = require('./buildEndpointOption');
const validateEmailLogin = require('./validateEmailLogin');
const validateMessageReq = require('./validateMessageReq');
const {
  canReadActiveJobConversation,
  prepareMessageRequestValidation,
  sendValidationResponse,
} = require('./messageValidation');
const checkDomainAllowed = require('./checkDomainAllowed');
const requireLocalAuth = require('./requireLocalAuth');
const canDeleteAccount = require('./canDeleteAccount');
const accessResources = require('./accessResources');
const requireLdapAuth = require('./requireLdapAuth');
const abortMiddleware = require('./abortMiddleware');
const requireJwtAuth = require('./requireJwtAuth');
const requireUnblocked = require('./requireUnblocked');
const { requireRumProxyAuth } = require('./requireJwtAuth');
const configMiddleware = require('./config/app');
const checkOfficeLimits = require('./officeLimits');
const validateModel = require('./validateModel');
const moderateText = require('./moderateText');
const logHeaders = require('./logHeaders');
const setHeaders = require('./setHeaders');
const validate = require('./validate');
const limiters = require('./limiters');
const uaParser = require('./uaParser');
const checkBan = require('./checkBan');
const noIndex = require('./noIndex');
const roles = require('./roles');

module.exports = {
  ...abortMiddleware,
  ...validate,
  ...limiters,
  ...roles,
  ...accessResources,
  noIndex,
  checkBan,
  uaParser,
  setHeaders,
  logHeaders,
  moderateText,
  validateModel,
  checkOfficeLimits,
  requireJwtAuth,
  requireUnblocked,
  requireRumProxyAuth,
  setTwoFactorTempUser,
  requireLdapAuth,
  requireLocalAuth,
  canDeleteAccount,
  configMiddleware,
  checkDomainAllowed,
  validateMessageReq,
  canReadActiveJobConversation,
  sendValidationResponse,
  prepareMessageRequestValidation,
  buildEndpointOption,
  validateRegistration,
  validatePasswordReset,
  validateEmailLogin,
};
