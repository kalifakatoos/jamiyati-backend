const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dbHelpers = require('../database/db');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { successResponse, errorResponse } = require('../utils/responseFormatter');

/**
 * Register a new user
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    const {
      name,
      phone,
      email,
      password,
      national_id,
      iban,
      bank_name,
      payment_handle
    } = req.body;

    if (!name || !phone || !password) {
      return errorResponse(res, 'الاسم ورقم الهاتف وكلمة المرور حقول إلزامية', 'VALIDATION_ERROR', 400);
    }

    if (password.length < 6) {
      return errorResponse(res, 'يجب أن تكون كلمة المرور 6 أحرف أو أرقام على الأقل', 'VALIDATION_ERROR', 400);
    }

    // Check phone uniqueness
    const existingPhone = await dbHelpers.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existingPhone) {
      return errorResponse(res, 'رقم الهاتف مسجل بالفعل مسبقاً', 'DUPLICATE_PHONE', 409);
    }

    // Check email uniqueness if email is provided
    if (email) {
      const existingEmail = await dbHelpers.get('SELECT id FROM users WHERE email = ?', [email]);
      if (existingEmail) {
        return errorResponse(res, 'البريد الإلكتروني مسجل بالفعل مسبقاً', 'DUPLICATE_EMAIL', 409);
      }
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    // Insert user
    const insertSql = `
      INSERT INTO users (
        name, phone, email, password_hash, national_id, iban, bank_name, payment_handle, trust_score, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 80, 1)
    `;

    const result = await dbHelpers.run(insertSql, [
      name.trim(),
      phone.trim(),
      email ? email.trim().toLowerCase() : null,
      passwordHash,
      national_id ? national_id.trim() : null,
      iban ? iban.trim() : null,
      bank_name ? bank_name.trim() : null,
      payment_handle ? payment_handle.trim() : null
    ]);

    const userId = result.lastID;

    // Issue JWT
    const token = jwt.sign(
      { id: userId, phone: phone.trim(), name: name.trim() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const user = {
      id: userId,
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : null,
      national_id: national_id || null,
      iban: iban || null,
      bank_name: bank_name || null,
      payment_handle: payment_handle || null,
      trust_score: 80
    };

    return successResponse(
      res,
      { token, user },
      'تم إنشاء الحساب بنجاح بنظام القرض الحسن',
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Login user
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return errorResponse(res, 'يرجى تزويد رقم الهاتف وكلمة المرور', 'VALIDATION_ERROR', 400);
    }

    const user = await dbHelpers.get('SELECT * FROM users WHERE phone = ?', [phone.trim()]);
    if (!user) {
      return errorResponse(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    if (user.is_active !== 1) {
      return errorResponse(res, 'هذا الحساب موقوف حالياً', 'FORBIDDEN', 403);
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return errorResponse(res, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS', 401);
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const userResponse = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      national_id: user.national_id,
      iban: user.iban,
      bank_name: user.bank_name,
      payment_handle: user.payment_handle,
      trust_score: user.trust_score
    };

    return successResponse(res, { token, user: userResponse }, 'تم تسجيل الدخول بنجاح');
  } catch (error) {
    next(error);
  }
}

/**
 * Get Current User Profile & Summary
 * GET /api/auth/me
 */
async function getMe(req, res, next) {
  try {
    const userId = req.user.id;

    const user = await dbHelpers.get(
      `SELECT id, name, phone, email, national_id, iban, bank_name, payment_handle, trust_score, is_active, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!user) {
      return errorResponse(res, 'المستخدم غير موجود', 'USER_NOT_FOUND', 404);
    }

    // Circles summary
    const circlesCount = await dbHelpers.get(
      `SELECT COUNT(DISTINCT circle_id) as total_circles
       FROM circle_members WHERE user_id = ? AND join_status IN ('joined', 'active')`,
      [userId]
    );

    // Completed circles
    const completedCircles = await dbHelpers.get(
      `SELECT COUNT(DISTINCT c.id) as completed_count
       FROM circles c
       JOIN circle_members cm ON c.id = cm.circle_id
       WHERE cm.user_id = ? AND c.status = 'completed'`,
      [userId]
    );

    // Guarantors
    const guarantors = await dbHelpers.all(
      `SELECT g.id, g.guarantor_user_id, u.name as guarantor_name, u.phone as guarantor_phone, g.status, g.relationship
       FROM guarantors g
       JOIN users u ON g.guarantor_user_id = u.id
       WHERE g.user_id = ?`,
      [userId]
    );

    return successResponse(res, {
      user,
      summary: {
        active_circles: circlesCount ? circlesCount.total_circles : 0,
        completed_circles: completedCircles ? completedCircles.completed_count : 0
      },
      guarantors
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update User Profile
 * PUT /api/auth/profile
 */
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const { name, email, national_id, iban, bank_name, payment_handle } = req.body;

    const currentUser = await dbHelpers.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!currentUser) {
      return errorResponse(res, 'المستخدم غير موجود', 'USER_NOT_FOUND', 404);
    }

    // Check email uniqueness if email is changed
    if (email && email.trim().toLowerCase() !== (currentUser.email || '').toLowerCase()) {
      const existingEmail = await dbHelpers.get('SELECT id FROM users WHERE email = ? AND id != ?', [
        email.trim().toLowerCase(),
        userId
      ]);
      if (existingEmail) {
        return errorResponse(res, 'البريد الإلكتروني مستخدم بالفعل بحساب آخر', 'DUPLICATE_EMAIL', 409);
      }
    }

    const updatedName = name !== undefined ? name.trim() : currentUser.name;
    const updatedEmail = email !== undefined ? (email ? email.trim().toLowerCase() : null) : currentUser.email;
    const updatedNationalId = national_id !== undefined ? national_id : currentUser.national_id;
    const updatedIban = iban !== undefined ? iban : currentUser.iban;
    const updatedBankName = bank_name !== undefined ? bank_name : currentUser.bank_name;
    const updatedPaymentHandle = payment_handle !== undefined ? payment_handle : currentUser.payment_handle;

    await dbHelpers.run(
      `UPDATE users
       SET name = ?, email = ?, national_id = ?, iban = ?, bank_name = ?, payment_handle = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [updatedName, updatedEmail, updatedNationalId, updatedIban, updatedBankName, updatedPaymentHandle, userId]
    );

    const updatedUser = await dbHelpers.get(
      `SELECT id, name, phone, email, national_id, iban, bank_name, payment_handle, trust_score, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    return successResponse(res, { user: updatedUser }, 'تم تحديث الملف الشخصي بنجاح');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  getMe,
  updateProfile
};
