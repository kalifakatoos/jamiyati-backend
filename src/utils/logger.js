/**
 * Formatted Console Logger
 */

const levels = {
  INFO: '\x1b[36m[INFO]\x1b[0m',
  SUCCESS: '\x1b[32m[SUCCESS]\x1b[0m',
  WARN: '\x1b[33m[WARN]\x1b[0m',
  ERROR: '\x1b[31m[ERROR]\x1b[0m'
};

function formatMessage(level, message, meta = '') {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${typeof meta === 'object' ? JSON.stringify(meta) : meta}` : '';
  return `${timestamp} ${level} ${message}${metaStr}`;
}

const logger = {
  info: (msg, meta) => console.log(formatMessage(levels.INFO, msg, meta)),
  success: (msg, meta) => console.log(formatMessage(levels.SUCCESS, msg, meta)),
  warn: (msg, meta) => console.warn(formatMessage(levels.WARN, msg, meta)),
  error: (msg, meta) => console.error(formatMessage(levels.ERROR, msg, meta))
};

module.exports = logger;
