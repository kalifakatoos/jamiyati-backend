const path = require('path');
const dbHelpers = require('../database/db');
const { successResponse, errorResponse } = require('../utils/responseFormatter');
const { TRUST_SCORE } = require('../config/constants');

/**
 * Get current active round for a circle
 * GET /api/circles/:id/rounds/current
 */
async function getCurrentRound(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const circle = await dbHelpers.get('SELECT * FROM circles WHERE id = ?', [circleId]);
    if (!circle) {
      return errorResponse(res, 'الجمعية غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    // Find active or collecting round
    let round = await dbHelpers.get(
      `SELECT r.*, u.id as ben_id, u.name as ben_name, u.phone as ben_phone,
              u.iban as ben_iban, u.bank_name as ben_bank_name, u.payment_handle as ben_payment_handle
       FROM rounds r
       JOIN users u ON r.beneficiary_user_id = u.id
       WHERE r.circle_id = ? AND r.status IN ('collecting', 'scheduled', 'delivered')
       ORDER BY r.round_number ASC LIMIT 1`,
      [circleId]
    );

    if (!round) {
      // If none active, check latest round
      round = await dbHelpers.get(
        `SELECT r.*, u.id as ben_id, u.name as ben_name, u.phone as ben_phone,
                u.iban as ben_iban, u.bank_name as ben_bank_name, u.payment_handle as ben_payment_handle
         FROM rounds r
         JOIN users u ON r.beneficiary_user_id = u.id
         WHERE r.circle_id = ?
         ORDER BY r.round_number DESC LIMIT 1`,
        [circleId]
      );
    }

    if (!round) {
      return errorResponse(res, 'لم يتم جدولة دورات لهذه الجمعية بعد', 'NO_ROUNDS_FOUND', 404);
    }

    // Get all payments for this round
    const payments = await dbHelpers.all(
      `SELECT p.id as payment_id, p.payer_id, p.beneficiary_id, p.expected_amount, p.status,
              p.paid_at, p.confirmed_at, p.admin_notes,
              u.name as payer_name, u.phone as payer_phone, u.trust_score as payer_trust_score,
              rec.image_url, rec.file_name, rec.transaction_ref, rec.transfer_date, rec.notes as receipt_notes
       FROM payments p
       JOIN users u ON p.payer_id = u.id
       LEFT JOIN receipts rec ON p.id = rec.payment_id
       WHERE p.round_id = ?`,
      [round.id]
    );

    // Current user's payment in this round
    const myPayment = payments.find((p) => p.payer_id === userId) || null;
    const isBeneficiary = round.beneficiary_user_id === userId;

    return successResponse(res, {
      circle: {
        id: circle.id,
        name: circle.name,
        monthly_amount: circle.monthly_amount,
        currency: circle.currency
      },
      current_round: {
        id: round.id,
        round_number: round.round_number,
        expected_pool_amount: round.expected_pool_amount,
        collected_amount: round.collected_amount,
        due_date: round.due_date,
        status: round.status,
        beneficiary: {
          id: round.ben_id,
          name: round.ben_name,
          phone: round.ben_phone,
          iban: round.ben_iban,
          bank_name: round.ben_bank_name,
          payment_handle: round.ben_payment_handle
        }
      },
      is_current_user_beneficiary: isBeneficiary,
      my_payment: myPayment,
      payments
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all rounds schedule for a circle
 * GET /api/circles/:id/schedule
 */
async function getSchedule(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);

    const rounds = await dbHelpers.all(
      `SELECT r.id, r.round_number, r.expected_pool_amount, r.collected_amount, r.due_date, r.status,
              u.id as beneficiary_id, u.name as beneficiary_name, u.phone as beneficiary_phone,
              (SELECT COUNT(*) FROM payments WHERE round_id = r.id AND status = 'confirmed') as confirmed_count,
              (SELECT COUNT(*) FROM payments WHERE round_id = r.id) as total_payments_count
       FROM rounds r
       JOIN users u ON r.beneficiary_user_id = u.id
       WHERE r.circle_id = ?
       ORDER BY r.round_number ASC`,
      [circleId]
    );

    return successResponse(res, { rounds }, 'تم جلب جدول دورات الجمعية بنجاح');
  } catch (error) {
    next(error);
  }
}

/**
 * Upload Receipt for P2P payment
 * POST /api/payments/:id/upload-receipt
 */
async function uploadReceipt(req, res, next) {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { transaction_ref, transfer_date, notes } = req.body;

    if (!req.file) {
      return errorResponse(res, 'يرجى إرفاق صورة إشعار التحويل البنكي', 'FILE_REQUIRED', 400);
    }

    if (!transaction_ref) {
      return errorResponse(res, 'رقم الحوالة المرجعي (Transaction Ref) إلزامي', 'VALIDATION_ERROR', 400);
    }

    const payment = await dbHelpers.get(
      `SELECT p.*, c.name as circle_name, u_ben.name as ben_name
       FROM payments p
       JOIN circles c ON p.circle_id = c.id
       JOIN users u_ben ON p.beneficiary_id = u_ben.id
       WHERE p.id = ?`,
      [paymentId]
    );

    if (!payment) {
      return errorResponse(res, 'سجل السداد المطلوب غير موجود', 'PAYMENT_NOT_FOUND', 404);
    }

    // Only the designated payer can upload receipt
    if (payment.payer_id !== userId) {
      return errorResponse(res, 'لا يمكنك رفع إشعار سداد لحساب عضو آخر', 'FORBIDDEN', 403);
    }

    if (payment.status === 'confirmed') {
      return errorResponse(res, 'تم تأكيد استلام هذا السداد مسبقاً ولا يمكن تعديله', 'ALREADY_CONFIRMED', 400);
    }

    // Relative image path
    const imageUrl = `/uploads/receipts/${req.file.filename}`;
    const transferDateTime = transfer_date ? new Date(transfer_date).toISOString() : new Date().toISOString();

    // Check if receipt already exists (replace or insert)
    const existingReceipt = await dbHelpers.get('SELECT id FROM receipts WHERE payment_id = ?', [paymentId]);

    if (existingReceipt) {
      await dbHelpers.run(
        `UPDATE receipts
         SET image_url = ?, file_name = ?, file_size = ?, mime_type = ?,
             transaction_ref = ?, transfer_date = ?, notes = ?, uploaded_at = CURRENT_TIMESTAMP
         WHERE payment_id = ?`,
        [
          imageUrl,
          req.file.filename,
          req.file.size,
          req.file.mimetype,
          transaction_ref.trim(),
          transferDateTime,
          notes ? notes.trim() : null,
          paymentId
        ]
      );
    } else {
      await dbHelpers.run(
        `INSERT INTO receipts (
          payment_id, image_url, file_name, file_size, mime_type, transaction_ref, transfer_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          imageUrl,
          req.file.filename,
          req.file.size,
          req.file.mimetype,
          transaction_ref.trim(),
          transferDateTime,
          notes ? notes.trim() : null
        ]
      );
    }

    // Update payment status
    await dbHelpers.run(
      `UPDATE payments
       SET status = 'receipt_uploaded', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [paymentId]
    );

    // Send notification to the Beneficiary
    await dbHelpers.run(
      `INSERT INTO notifications (user_id, title, body, type, metadata)
       VALUES (?, ?, ?, 'receipt_uploaded', ?)`,
      [
        payment.beneficiary_id,
        'تم رفع إشعار تحويل جديد',
        `قام العضو ${req.user.name} برفع إشعار تحويل بقيمة ${payment.expected_amount} ريال في جمعية "${payment.circle_name}". يرجى التحقق من حسابك وتأكيد الاستلام.`,
        JSON.stringify({ payment_id: paymentId, payer_id: userId, transaction_ref })
      ]
    );

    return successResponse(
      res,
      {
        payment_id: paymentId,
        status: 'receipt_uploaded',
        receipt: {
          image_url: imageUrl,
          transaction_ref: transaction_ref.trim(),
          file_name: req.file.filename,
          uploaded_at: new Date().toISOString()
        }
      },
      'تم رفع إشعار التحويل وبانتظار تأكيد المستلم'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Confirm Receipt (التوثيق والإشهاد الثنائي)
 * PUT /api/payments/:id/confirm-receipt
 */
async function confirmReceipt(req, res, next) {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { notes } = req.body;

    const payment = await dbHelpers.get(
      `SELECT p.*, c.creator_id, c.name as circle_name, u_payer.name as payer_name
       FROM payments p
       JOIN circles c ON p.circle_id = c.id
       JOIN users u_payer ON p.payer_id = u_payer.id
       WHERE p.id = ?`,
      [paymentId]
    );

    if (!payment) {
      return errorResponse(res, 'سجل السداد غير موجود', 'PAYMENT_NOT_FOUND', 404);
    }

    // Strict Authorization: Beneficiary of round OR Circle Admin
    const isBeneficiary = payment.beneficiary_id === userId;
    const isCircleAdmin = payment.creator_id === userId;

    if (!isBeneficiary && !isCircleAdmin) {
      return errorResponse(
        res,
        'غير مخول: فقط المستلم الفعلي للمبلغ أو مسؤول الجمعية يحق له تأكيد استلام الحوالة',
        'UNAUTHORIZED_CONFIRMATION',
        403
      );
    }

    if (payment.status === 'confirmed') {
      return errorResponse(res, 'تم تأكيد الاستلام مسبقاً', 'ALREADY_CONFIRMED', 400);
    }

    if (payment.status !== 'receipt_uploaded') {
      return errorResponse(
        res,
        'لا يمكن تأكيد الاستلام قبل رفع إشعار التحويل البنكي من العضو المسدد',
        'NO_RECEIPT_UPLOADED',
        400
      );
    }

    const confirmedAt = new Date().toISOString();

    // 1. Update Payment Status to 'confirmed'
    // (This automatically fires trigger trg_update_round_collected and trg_auto_deliver_round)
    await dbHelpers.run(
      `UPDATE payments
       SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [notes ? notes.trim() : null, paymentId]
    );

    // 2. Award Trust Points to Payer (+3 points)
    // (This automatically fires trigger trg_apply_trust_score)
    const pointsAwarded = TRUST_SCORE.ON_TIME_PAYMENT || 3;
    await dbHelpers.run(
      `INSERT INTO trust_logs (user_id, change_amount, reason, circle_id, round_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        payment.payer_id,
        pointsAwarded,
        `سداد مستحق الجمعية (${payment.circle_name}) وتأكيد الاستلام شرعاً`,
        payment.circle_id,
        payment.round_id
      ]
    );

    // 3. Notify Payer
    await dbHelpers.run(
      `INSERT INTO notifications (user_id, title, body, type, metadata)
       VALUES (?, ?, ?, 'receipt_confirmed', ?)`,
      [
        payment.payer_id,
        'تم تأكيد استلام سدادك بنجاح',
        `أكد المستلم استلام مبلغ ${payment.expected_amount} ريال في جمعية "${payment.circle_name}". تم إضافة ${pointsAwarded} نقاط لتقييم الثقة.`,
        JSON.stringify({ payment_id: paymentId, points_awarded: pointsAwarded })
      ]
    );

    return successResponse(
      res,
      {
        payment_id: paymentId,
        status: 'confirmed',
        confirmed_at: confirmedAt,
        trust_points_awarded: pointsAwarded
      },
      'تم تأكيد الاستلام بنجاح وتحديث نقاط الثقة'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Dispute Payment (في حال عدم وصول المبلغ أو وجود خطأ بالإيصال)
 * PUT /api/payments/:id/dispute
 */
async function disputePayment(req, res, next) {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { reason } = req.body;

    const payment = await dbHelpers.get(
      `SELECT p.*, c.creator_id, c.name as circle_name
       FROM payments p
       JOIN circles c ON p.circle_id = c.id
       WHERE p.id = ?`,
      [paymentId]
    );

    if (!payment) {
      return errorResponse(res, 'سجل السداد غير موجود', 'PAYMENT_NOT_FOUND', 404);
    }

    if (payment.beneficiary_id !== userId && payment.creator_id !== userId) {
      return errorResponse(res, 'فقط المستلم أو مسؤول الجمعية يمكنه فتح اعتراض', 'FORBIDDEN', 403);
    }

    const disputeReason = reason || 'لم يصل المبلغ للحساب البنكي أو الإيصال غير مطابق';

    await dbHelpers.run(
      `UPDATE payments
       SET status = 'disputed', admin_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [disputeReason, paymentId]
    );

    // Insert into audit logs
    await dbHelpers.run(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES (?, 'PAYMENT_DISPUTED', 'payments', ?, ?)`,
      [userId, paymentId, JSON.stringify({ reason: disputeReason })]
    );

    // Notify payer
    await dbHelpers.run(
      `INSERT INTO notifications (user_id, title, body, type, metadata)
       VALUES (?, ?, ?, 'system', ?)`,
      [
        payment.payer_id,
        'تنبيه: تم تقديم اعتراض على إشعار السداد',
        `أفاد المستلم بعدم وصول الحوالة لجمعية "${payment.circle_name}". يرجى مراجعة كشف حسابك والتواصل مع المستلم أو المسؤول.`,
        JSON.stringify({ payment_id: paymentId, reason: disputeReason })
      ]
    );

    return successResponse(
      res,
      { payment_id: paymentId, status: 'disputed', reason: disputeReason },
      'تم تسجيل الاعتراض وإشعار المسدد ومسؤول الجمعية'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Get User Trust Score & Badges
 * GET /api/users/:id/trust-score
 */
async function getUserTrustScore(req, res, next) {
  try {
    const targetUserId = parseInt(req.params.id, 10);

    const user = await dbHelpers.get('SELECT id, name, trust_score, created_at FROM users WHERE id = ?', [
      targetUserId
    ]);

    if (!user) {
      return errorResponse(res, 'المستخدم غير موجود', 'USER_NOT_FOUND', 404);
    }

    // Completed circles
    const completedCirclesRow = await dbHelpers.get(
      `SELECT COUNT(DISTINCT c.id) as count
       FROM circles c
       JOIN circle_members cm ON c.id = cm.circle_id
       WHERE cm.user_id = ? AND c.status = 'completed'`,
      [targetUserId]
    );
    const completedCircles = completedCirclesRow ? completedCirclesRow.count : 0;

    // On-time payments
    const onTimePaymentsRow = await dbHelpers.get(
      `SELECT COUNT(*) as count
       FROM payments
       WHERE payer_id = ? AND status = 'confirmed'`,
      [targetUserId]
    );
    const onTimePayments = onTimePaymentsRow ? onTimePaymentsRow.count : 0;

    // Delayed or disputed payments
    const disputedPaymentsRow = await dbHelpers.get(
      `SELECT COUNT(*) as count
       FROM payments
       WHERE payer_id = ? AND status = 'disputed'`,
      [targetUserId]
    );
    const delayedPayments = disputedPaymentsRow ? disputedPaymentsRow.count : 0;

    // Tier calculation
    let tier = 'Bronze (فئة برونزية)';
    if (user.trust_score >= 90) {
      tier = 'Platinum (فئة بلاتينية)';
    } else if (user.trust_score >= 80) {
      tier = 'Gold (فئة ذهبية)';
    } else if (user.trust_score >= 70) {
      tier = 'Silver (فئة فضية)';
    }

    // Dynamic badges based on verified actions
    const badges = [];
    if (onTimePayments >= 1) {
      badges.push({ id: 'covenant_keeper', name: 'الملتزم بالعهد', icon: 'shield_check' });
    }
    if (completedCircles >= 1) {
      badges.push({ id: 'trusted_member', name: 'عضو موثوق ومجرب', icon: 'check_circle' });
    }
    const createdCountRow = await dbHelpers.get('SELECT COUNT(*) as count FROM circles WHERE creator_id = ?', [
      targetUserId
    ]);
    if (createdCountRow && createdCountRow.count >= 1) {
      badges.push({ id: 'trusted_founder', name: 'مؤسس جمعيات موثوق', icon: 'star' });
    }
    const guarantorCountRow = await dbHelpers.get(
      'SELECT COUNT(*) as count FROM guarantors WHERE guarantor_user_id = ? AND status = "accepted"',
      [targetUserId]
    );
    if (guarantorCountRow && guarantorCountRow.count >= 1) {
      badges.push({ id: 'verified_guarantor', name: 'ضامن معتمد', icon: 'handshake' });
    }

    // If no badges yet, grant initial starter badge
    if (badges.length === 0) {
      badges.push({ id: 'new_member', name: 'عضو منضم حديثاً', icon: 'person' });
    }

    return successResponse(res, {
      user_id: user.id,
      name: user.name,
      trust_score: user.trust_score,
      tier,
      completed_circles: completedCircles,
      on_time_payments: onTimePayments,
      delayed_payments: delayedPayments,
      badges
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Specific Payment by ID
 * GET /api/payments/:id
 */
async function getPaymentById(req, res, next) {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const payment = await dbHelpers.get(
      `SELECT p.*, c.name as circle_name, c.currency,
              u_payer.name as payer_name, u_payer.phone as payer_phone, u_payer.trust_score as payer_trust_score,
              u_ben.name as beneficiary_name, u_ben.phone as beneficiary_phone,
              u_ben.iban as beneficiary_iban, u_ben.bank_name as beneficiary_bank, u_ben.payment_handle as beneficiary_handle,
              rec.image_url, rec.file_name, rec.transaction_ref, rec.transfer_date, rec.notes as receipt_notes
       FROM payments p
       JOIN circles c ON p.circle_id = c.id
       JOIN users u_payer ON p.payer_id = u_payer.id
       JOIN users u_ben ON p.beneficiary_id = u_ben.id
       LEFT JOIN receipts rec ON p.id = rec.payment_id
       WHERE p.id = ?`,
      [paymentId]
    );

    if (!payment) {
      return errorResponse(res, 'سجل السداد غير موجود', 'PAYMENT_NOT_FOUND', 404);
    }

    return successResponse(res, { payment });
  } catch (error) {
    next(error);
  }
}

/**
 * Get Round by Circle ID and Round Number
 * GET /api/circles/:id/rounds/:roundNumber
 */
async function getRoundByNumber(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);
    const roundNumber = parseInt(req.params.roundNumber, 10);

    const round = await dbHelpers.get(
      `SELECT r.*, u.id as ben_id, u.name as ben_name, u.phone as ben_phone,
              u.iban as ben_iban, u.bank_name as ben_bank_name, u.payment_handle as ben_payment_handle
       FROM rounds r
       JOIN users u ON r.beneficiary_user_id = u.id
       WHERE r.circle_id = ? AND r.round_number = ?`,
      [circleId, roundNumber]
    );

    if (!round) {
      return errorResponse(res, 'الدورة المطلوبة غير موجودة', 'ROUND_NOT_FOUND', 404);
    }

    const payments = await dbHelpers.all(
      `SELECT p.id as payment_id, p.payer_id, p.beneficiary_id, p.expected_amount, p.status,
              p.paid_at, p.confirmed_at, p.admin_notes,
              u.name as payer_name, u.phone as payer_phone, u.trust_score as payer_trust_score,
              rec.image_url, rec.file_name, rec.transaction_ref, rec.transfer_date
       FROM payments p
       JOIN users u ON p.payer_id = u.id
       LEFT JOIN receipts rec ON p.id = rec.payment_id
       WHERE p.round_id = ?`,
      [round.id]
    );

    return successResponse(res, { round, payments });
  } catch (error) {
    next(error);
  }
}

/**
 * Get User Notifications
 * GET /api/notifications
 */
async function getUserNotifications(req, res, next) {
  try {
    const userId = req.user.id;

    const notifications = await dbHelpers.all(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    const unreadCountRow = await dbHelpers.get(
      `SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    return successResponse(res, {
      unread_count: unreadCountRow ? unreadCountRow.unread : 0,
      notifications
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark Notification as Read
 * PUT /api/notifications/:id/read
 */
async function markNotificationRead(req, res, next) {
  try {
    const notifId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    await dbHelpers.run(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [notifId, userId]
    );

    return successResponse(res, { id: notifId, is_read: 1 });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCurrentRound,
  getRoundByNumber,
  getSchedule,
  getPaymentById,
  uploadReceipt,
  confirmReceipt,
  disputePayment,
  getUserTrustScore,
  getUserNotifications,
  markNotificationRead
};
