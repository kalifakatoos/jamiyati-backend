const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || 'jamiyati_halal_rosca_secret_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../database/jamiyati.sqlite'),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads/receipts'),
  MAX_FILE_SIZE: 5 * 1024 * 1024 // 5MB
};
