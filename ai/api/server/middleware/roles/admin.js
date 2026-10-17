const { isAdminLevelRole } = require('librechat-data-provider');

function checkAdmin(req, res, next) {
  try {
    if (!isAdminLevelRole(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

module.exports = checkAdmin;
