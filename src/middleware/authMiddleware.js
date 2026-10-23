const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const dbHelpers = require('../database/db');
const { errorResponse } = require('../utils/responseFormatter');

/**
 * Authentication Middleware
 * Validates JWT Bearer token and attaches user record to req.user
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'يرجى تسجيل الدخول للوصول إلى هذه الخدمة', 'UNAUTHORIZED', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return errorResponse(res, 'رمز التوثيق غير متوفر', 'UNAUTHORIZED', 401);
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.id) {
      return errorResponse(res, 'رمز التوثيق غير صالح أو منتهي الصلاحية', 'UNAUTHORIZED', 401);
    }

    const user = await dbHelpers.get(
      'SELECT id, name, phone, email, trust_score, iban, bank_name, payment_handle, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!user) {
      return errorResponse(res, 'المستخدم غير مسجل بالمنظومة', 'USER_NOT_FOUND', 404);
    }

    if (user.is_active !== 1) {
      return errorResponse(res, 'هذا الحساب غير نشط حالياً', 'FORBIDDEN', 403);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return errorResponse(res, 'انتهت صلاحية جلسة الدخول، يرجى إعادة تسجيل الدخول', 'TOKEN_EXPIRED', 401);
    }
    return errorResponse(res, 'جلسة غير صالحة أو خطأ في التحقق من التوثيق', 'UNAUTHORIZED', 401);
  }
}

module.exports = {
  authenticate
};
