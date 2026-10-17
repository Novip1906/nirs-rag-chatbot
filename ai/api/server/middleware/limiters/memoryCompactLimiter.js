const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const MEMORY_COMPACT_WINDOW_MS = 10 * 60 * 1000;
const MEMORY_COMPACT_MAX = 5;

const memoryCompactLimiter = rateLimit({
  windowMs: MEMORY_COMPACT_WINDOW_MS,
  max: MEMORY_COMPACT_MAX,
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many memory compaction requests. Try again later' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('memory_compact_limiter'),
});

module.exports = { memoryCompactLimiter };
