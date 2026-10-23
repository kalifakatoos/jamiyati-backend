const crypto = require('crypto');
const dbHelpers = require('../database/db');
const { successResponse, errorResponse } = require('../utils/responseFormatter');

/**
 * Generate a clean unique invite code
 * Format: JAM-XXXX-YYY
 */
function generateInviteCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  const randStr = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `JAM-${num}-${randStr}`;
}

/**
 * Create a new ROSCA Circle
 * POST /api/circles
 */
async function createCircle(req, res, next) {
  try {
    const creatorId = req.user.id;
    const {
      name,
      description,
      monthly_amount,
      currency = 'LYD',
      total_members,
      frequency = 'monthly',
      start_date,
      payment_day_of_month,
      turn_determination_method = 'random_draw'
    } = req.body;

    if (!name || !monthly_amount || !total_members || !start_date || !payment_day_of_month) {
      return errorResponse(res, 'يرجى استكمال جميع بيانات الجمعية الأساسية', 'VALIDATION_ERROR', 400);
    }

    const numMembers = parseInt(total_members, 10);
    const amount = parseFloat(monthly_amount);
    const payDay = parseInt(payment_day_of_month, 10);

    if (isNaN(numMembers) || numMembers < 2) {
      return errorResponse(res, 'يجب أن لا يقل عدد أعضاء الجمعية عن عضوين (2)', 'VALIDATION_ERROR', 400);
    }

    if (isNaN(amount) || amount <= 0) {
      return errorResponse(res, 'يجب أن يكون القسط الشهري أكبر من صفر', 'VALIDATION_ERROR', 400);
    }

    if (isNaN(payDay) || payDay < 1 || payDay > 31) {
      return errorResponse(res, 'يوم السداد الشهري يجب أن يكون بين 1 و 31', 'VALIDATION_ERROR', 400);
    }

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    let isCodeUnique = false;
    while (!isCodeUnique) {
      const existing = await dbHelpers.get('SELECT id FROM circles WHERE invite_code = ?', [inviteCode]);
      if (!existing) {
        isCodeUnique = true;
      } else {
        inviteCode = generateInviteCode();
      }
    }

    // Insert circle
    const insertCircleSql = `
      INSERT INTO circles (
        creator_id, name, description, monthly_amount, currency, total_members,
        frequency, start_date, payment_day_of_month, status, turn_determination_method, invite_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `;

    const circleResult = await dbHelpers.run(insertCircleSql, [
      creatorId,
      name.trim(),
      description ? description.trim() : null,
      amount,
      currency.toUpperCase(),
      numMembers,
      frequency,
      start_date,
      payDay,
      turn_determination_method,
      inviteCode
    ]);

    const circleId = circleResult.lastID;

    // Automatically add creator as admin member
    await dbHelpers.run(
      `INSERT INTO circle_members (circle_id, user_id, role, join_status)
       VALUES (?, ?, 'admin', 'joined')`,
      [circleId, creatorId]
    );

    const createdCircle = await dbHelpers.get('SELECT * FROM circles WHERE id = ?', [circleId]);

    return successResponse(
      res,
      {
        id: createdCircle.id,
        name: createdCircle.name,
        invite_code: createdCircle.invite_code,
        status: createdCircle.status,
        total_members: createdCircle.total_members,
        monthly_amount: createdCircle.monthly_amount,
        currency: createdCircle.currency,
        created_at: createdCircle.created_at
      },
      'تم إنشاء الجمعية بنجاح بنظام القرض الحسن',
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * List Circles for current user
 * GET /api/circles
 */
async function listCircles(req, res, next) {
  try {
    const userId = req.user.id;

    const circles = await dbHelpers.all(
      `SELECT 
        c.id, c.name, c.description, c.monthly_amount, c.currency, c.total_members,
        c.frequency, c.start_date, c.payment_day_of_month, c.status, c.invite_code,
        c.created_at, u.name as creator_name,
        cm.role as my_role, cm.assigned_turn,
        (SELECT COUNT(*) FROM circle_members WHERE circle_id = c.id AND join_status IN ('joined', 'active')) as current_members_count
       FROM circles c
       JOIN users u ON c.creator_id = u.id
       JOIN circle_members cm ON c.id = cm.circle_id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC`,
      [userId]
    );

    return successResponse(res, { circles }, 'تم جلب قائمة الجمعيات بنجاح');
  } catch (error) {
    next(error);
  }
}

/**
 * Get Circle details by ID
 * GET /api/circles/:id
 */
async function getCircleById(req, res, next) {
  try {
    const circleId = req.params.id;
    const userId = req.user.id;

    const circle = await dbHelpers.get(
      `SELECT c.*, u.name as creator_name, u.phone as creator_phone
       FROM circles c
       JOIN users u ON c.creator_id = u.id
       WHERE c.id = ?`,
      [circleId]
    );

    if (!circle) {
      return errorResponse(res, 'الجمعية المطلوبة غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    // Check membership
    const membership = await dbHelpers.get(
      'SELECT role, join_status, assigned_turn FROM circle_members WHERE circle_id = ? AND user_id = ?',
      [circleId, userId]
    );

    // Get all members
    const members = await dbHelpers.all(
      `SELECT u.id, u.name, u.phone, u.trust_score, u.iban, u.bank_name, u.payment_handle,
              cm.role, cm.join_status, cm.assigned_turn, cm.joined_at
       FROM circle_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.circle_id = ?
       ORDER BY cm.role ASC, cm.joined_at ASC`,
      [circleId]
    );

    // Current active round if circle is active
    let currentRound = null;
    if (circle.status === 'active' || circle.status === 'completed') {
      const activeRound = await dbHelpers.get(
        `SELECT r.*, u.id as ben_id, u.name as ben_name, u.phone as ben_phone,
                u.iban as ben_iban, u.bank_name as ben_bank_name, u.payment_handle as ben_payment_handle
         FROM rounds r
         JOIN users u ON r.beneficiary_user_id = u.id
         WHERE r.circle_id = ? AND r.status IN ('collecting', 'scheduled', 'delivered')
         ORDER BY r.round_number ASC LIMIT 1`,
        [circleId]
      );

      if (activeRound) {
        currentRound = {
          id: activeRound.id,
          round_number: activeRound.round_number,
          beneficiary: {
            id: activeRound.ben_id,
            name: activeRound.ben_name,
            phone: activeRound.ben_phone,
            iban: activeRound.ben_iban,
            bank_name: activeRound.ben_bank_name,
            payment_handle: activeRound.ben_payment_handle
          },
          expected_pool_amount: activeRound.expected_pool_amount,
          collected_amount: activeRound.collected_amount,
          due_date: activeRound.due_date,
          status: activeRound.status
        };
      }
    }

    // Turns schedule if draw was executed
    let turns = [];
    if (circle.draw_seed) {
      turns = await dbHelpers.all(
        `SELECT t.round_number, t.payout_date, t.is_mutual_priority, t.priority_reason,
                u.id as user_id, u.name as user_name, u.trust_score, u.iban, u.bank_name, u.payment_handle
         FROM turns t
         JOIN users u ON t.assigned_user_id = u.id
         WHERE t.circle_id = ?
         ORDER BY t.round_number ASC`,
        [circleId]
      );
    }

    return successResponse(res, {
      ...circle,
      my_membership: membership || null,
      current_round: currentRound,
      members,
      turns
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Join Circle using invite code
 * POST /api/circles/join/:inviteCode
 */
async function joinCircleByCode(req, res, next) {
  try {
    const inviteCode = (req.params.inviteCode || '').trim();
    const userId = req.user.id;

    if (!inviteCode) {
      return errorResponse(res, 'يرجى إدخال رمز دعوة الجمعية', 'VALIDATION_ERROR', 400);
    }

    const circle = await dbHelpers.get('SELECT * FROM circles WHERE invite_code = ?', [inviteCode]);
    if (!circle) {
      return errorResponse(res, 'رمز الدعوة غير صحيح، الجمعية غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    if (circle.status !== 'open') {
      return errorResponse(
        res,
        'لا يمكن الانضمام للجمعية حالياً؛ الجمعية اكتملت أو بدأت دورتها بالفعل',
        'CIRCLE_NOT_OPEN',
        400
      );
    }

    // Check if user is already a member
    const existingMember = await dbHelpers.get(
      'SELECT id, join_status FROM circle_members WHERE circle_id = ? AND user_id = ?',
      [circle.id, userId]
    );

    if (existingMember) {
      return errorResponse(res, 'أنت مسجل بالفعل كعضو في هذه الجمعية', 'ALREADY_MEMBER', 400);
    }

    // Check capacity
    const countRow = await dbHelpers.get(
      `SELECT COUNT(*) as member_count FROM circle_members WHERE circle_id = ? AND join_status IN ('joined', 'active')`,
      [circle.id]
    );

    const currentCount = countRow ? countRow.member_count : 0;
    if (currentCount >= circle.total_members) {
      return errorResponse(res, 'اكتمل العدد المطلوب لأعضاء هذه الجمعية بالكامل', 'CIRCLE_FULL', 400);
    }

    // Add member
    await dbHelpers.run(
      `INSERT INTO circle_members (circle_id, user_id, role, join_status)
       VALUES (?, ?, 'member', 'joined')`,
      [circle.id, userId]
    );

    const newCount = currentCount + 1;

    // Check if slots are now full
    if (newCount === circle.total_members) {
      await dbHelpers.run(
        `UPDATE circles SET status = 'ready_for_draw', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [circle.id]
      );
    }

    return successResponse(
      res,
      {
        circle_id: circle.id,
        circle_name: circle.name,
        joined_status: 'joined',
        total_members: circle.total_members,
        current_members: newCount,
        is_ready_for_draw: newCount === circle.total_members
      },
      'تم الانضمام للجمعية بنجاح بنظام القرض الحسن'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Get Members Roster for a Circle
 * GET /api/circles/:id/members
 */
async function getCircleMembers(req, res, next) {
  try {
    const circleId = req.params.id;

    const members = await dbHelpers.all(
      `SELECT u.id, u.name, u.phone, u.trust_score, u.iban, u.bank_name, u.payment_handle,
              cm.role, cm.join_status, cm.assigned_turn, cm.joined_at
       FROM circle_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.circle_id = ?
       ORDER BY cm.role ASC, cm.joined_at ASC`,
      [circleId]
    );

    return successResponse(res, { members });
  } catch (error) {
    next(error);
  }
}

/**
 * Leave Circle (Allowed only if circle is open and draw has not been executed)
 * POST /api/circles/:id/leave
 */
async function leaveCircle(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const circle = await dbHelpers.get('SELECT * FROM circles WHERE id = ?', [circleId]);
    if (!circle) {
      return errorResponse(res, 'الجمعية غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    if (circle.status !== 'open' && circle.status !== 'ready_for_draw') {
      return errorResponse(
        res,
        'لا يمكن الانسحاب بعد إجراء القرعة وبدء دورات الجمعية المالية',
        'CANNOT_LEAVE_ACTIVE_CIRCLE',
        400
      );
    }

    if (circle.creator_id === userId) {
      return errorResponse(
        res,
        'لا يمكن لمنشئ الجمعية الانسحاب منها؛ يمكنك إلغاء الجمعية في حال عدم البدء',
        'CREATOR_CANNOT_LEAVE',
        400
      );
    }

    await dbHelpers.run('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?', [circleId, userId]);

    // Recalculate status back to 'open' if it was 'ready_for_draw'
    await dbHelpers.run(
      `UPDATE circles SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [circleId]
    );

    return successResponse(res, { circle_id: circleId }, 'تم الانسحاب من الجمعية بنجاح');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createCircle,
  listCircles,
  getCircleById,
  getCircleMembers,
  joinCircleByCode,
  leaveCircle
};
