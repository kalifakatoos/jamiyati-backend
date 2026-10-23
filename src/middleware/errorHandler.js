const multer = require('multer');
const { errorResponse } = require('../utils/responseFormatter');
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled Application Error:', err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return errorResponse(res, 'حجم الملف يتجاوز الحد المسموح به (5 ميجابايت)', 'FILE_TOO_LARGE', 400);
    }
    return errorResponse(res, `خطأ في رفع الملف: ${err.message}`, 'UPLOAD_ERROR', 400);
  }

  if (err.message && err.message.includes('الملف غير مدعوم')) {
    return errorResponse(res, err.message, 'INVALID_FILE_TYPE', 400);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'حدث خطأ داخلي في الخادم';
  const code = err.code || 'INTERNAL_SERVER_ERROR';

  return errorResponse(res, message, code, statusCode, process.env.NODE_ENV === 'development' ? err.stack : null);
}

module.exports = errorHandler;
