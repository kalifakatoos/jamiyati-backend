const dbHelpers = require('./db');
const logger = require('../utils/logger');

async function main() {
  try {
    logger.info('Initializing Jamiyati database schema...');
    await dbHelpers.initSchema();
    logger.success('Database initialization complete.');
    process.exit(0);
  } catch (err) {
    logger.error('Database initialization failed:', err);
    process.exit(1);
  }
}

main();
