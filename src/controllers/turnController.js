const dbHelpers = require('../database/db');
const { executeShariaFairDraw, calculateRoundDueDate } = require('../services/drawService');
const { successResponse, errorResponse } = require('../utils/responseFormatter');

/**
 * Execute Sharia Fair Draw
 * POST /api/circles/:id/draw
 */
async function executeDraw(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const { priority_slots = [] } = req.body;

    const circle = await dbHelpers.get('SELECT * FROM circles WHERE id = ?', [circleId]);
    if (!circle) {
      return errorResponse(res, 'الجمعية غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    // Only Creator / Admin can trigger the draw
    if (circle.creator_id !== userId) {
      const adminMember = await dbHelpers.get(
        'SELECT id FROM circle_members WHERE circle_id = ? AND user_id = ? AND role = "admin"',
        [circleId, userId]
      );
      if (!adminMember) {
        return errorResponse(res, 'فقط مسؤول الجمعية مخول بإجراء القرعة', 'UNAUTHORIZED', 403);
      }
    }

    if (circle.status === 'active' || circle.status === 'completed') {
      return errorResponse(res, 'تم إجراء القرعة لهذه الجمعية مسبقاً والجدول نشط بالفعل', 'ALREADY_ACTIVE', 400);
    }

    // Fetch all members
    const members = await dbHelpers.all(
      `SELECT u.id as user_id, u.name as user_name, cm.role
       FROM circle_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.circle_id = ? AND cm.join_status IN ('joined', 'active')`,
      [circleId]
    );

    if (members.length !== circle.total_members) {
      return errorResponse(
        res,
        `لا يمكن إجراء القرعة حتى يكتمل عدد الأعضاء (${members.length}/${circle.total_members})`,
        'INCOMPLETE_MEMBERS',
        400
      );
    }

    // Prepare priority slots mapping (التراضي لذوي الحاجة)
    const priorityMap = new Map();
    if (Array.isArray(priority_slots)) {
      for (const slot of priority_slots) {
        if (slot.user_id && slot.round_number) {
          priorityMap.set(parseInt(slot.user_id, 10), {
            round_number: parseInt(slot.round_number, 10),
            reason: slot.reason || 'ظرف عاجل بالتراضي'
          });
        }
      }
    }

    const memberSlots = members.map((m) => {
      const prio = priorityMap.get(m.user_id);
      return {
        userId: m.user_id,
        userName: m.user_name,
        isMutualPriority: !!prio,
        priorityRound: prio ? prio.round_number : undefined,
        priorityReason: prio ? prio.reason : undefined
      };
    });

    // Execute Sharia Fair Draw
    const drawResult = executeShariaFairDraw(
      circle.id,
      memberSlots,
      circle.total_members,
      circle.created_at
    );

    // Persist Turns, Rounds, and Payments
    // 1. Delete any previously generated turns/rounds/payments if draft
    await dbHelpers.run('DELETE FROM payments WHERE circle_id = ?', [circleId]);
    await dbHelpers.run('DELETE FROM rounds WHERE circle_id = ?', [circleId]);
    await dbHelpers.run('DELETE FROM turns WHERE circle_id = ?', [circleId]);

    const createdSchedule = [];

    for (const item of drawResult.schedule) {
      const payoutDate = calculateRoundDueDate(circle.start_date, circle.payment_day_of_month, item.roundNumber);

      // Insert Turn
      await dbHelpers.run(
        `INSERT INTO turns (
          circle_id, round_number, assigned_user_id, payout_date, is_locked, is_mutual_priority, priority_reason
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [
          circleId,
          item.roundNumber,
          item.userId,
          payoutDate,
          item.isPriority ? 1 : 0,
          item.reason || null
        ]
      );

      // Update Member assigned turn
      await dbHelpers.run(
        `UPDATE circle_members SET assigned_turn = ? WHERE circle_id = ? AND user_id = ?`,
        [item.roundNumber, circleId, item.userId]
      );

      // Expected pool = monthly_amount * (total_members - 1)
      const expectedPool = circle.monthly_amount * (circle.total_members - 1);
      const roundStatus = item.roundNumber === 1 ? 'collecting' : 'scheduled';

      // Insert Round
      const roundRes = await dbHelpers.run(
        `INSERT INTO rounds (
          circle_id, round_number, beneficiary_user_id, expected_pool_amount, collected_amount, due_date, status
        ) VALUES (?, ?, ?, ?, 0.0, ?, ?)`,
        [
          circleId,
          item.roundNumber,
          item.userId,
          expectedPool,
          payoutDate,
          roundStatus
        ]
      );

      const roundId = roundRes.lastID;

      // Insert P2P Payments for this round (All other members pay the beneficiary)
      for (const m of members) {
        if (m.user_id !== item.userId) {
          await dbHelpers.run(
            `INSERT INTO payments (
              round_id, circle_id, payer_id, beneficiary_id, expected_amount, status
            ) VALUES (?, ?, ?, ?, ?, 'unpaid')`,
            [roundId, circleId, m.user_id, item.userId, circle.monthly_amount]
          );
        }
      }

      createdSchedule.push({
        round_number: item.roundNumber,
        user_id: item.userId,
        name: item.userName,
        payout_date: payoutDate,
        is_priority: item.isPriority,
        reason: item.reason
      });
    }

    // Update Circle status
    await dbHelpers.run(
      `UPDATE circles
       SET status = 'active', draw_seed = ?, draw_executed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [drawResult.seed, circleId]
    );

    // Send notifications to all members
    for (const m of members) {
      await dbHelpers.run(
        `INSERT INTO notifications (user_id, title, body, type, metadata)
         VALUES (?, ?, ?, 'draw_completed', ?)`,
        [
          m.user_id,
          'تم إجراء القرعة الشرعية بنجاح',
          `تم إجراء القرعة وتوزيع الأدوار لجمعية "${circle.name}" بنظام عادل وشفاف.`,
          JSON.stringify({ circle_id: circleId, draw_seed: drawResult.seed })
        ]
      );
    }

    return successResponse(
      res,
      {
        circle_id: circleId,
        draw_seed: drawResult.seed,
        executed_at: drawResult.executedAt,
        schedule: createdSchedule
      },
      'تم إجراء القرعة الشرعية بنجاح واعتماد جدول الأدوار'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Get ordered turns list for a circle
 * GET /api/circles/:id/turns
 */
async function getTurns(req, res, next) {
  try {
    const circleId = parseInt(req.params.id, 10);

    const circle = await dbHelpers.get('SELECT id, name, status, draw_seed FROM circles WHERE id = ?', [circleId]);
    if (!circle) {
      return errorResponse(res, 'الجمعية غير موجودة', 'CIRCLE_NOT_FOUND', 404);
    }

    const turns = await dbHelpers.all(
      `SELECT t.id as turn_id, t.round_number, t.assigned_user_id, t.payout_date,
              t.is_locked, t.is_mutual_priority, t.priority_reason, t.swap_pending_with_user_id,
              u.name as user_name, u.phone as user_phone, u.trust_score,
              u.iban, u.bank_name, u.payment_handle
       FROM turns t
       JOIN users u ON t.assigned_user_id = u.id
       WHERE t.circle_id = ?
       ORDER BY t.round_number ASC`,
      [circleId]
    );

    return successResponse(res, {
      circle_id: circleId,
      circle_name: circle.name,
      draw_seed: circle.draw_seed,
      turns
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Request Turn Swap
 * POST /api/turns/swap-request
 */
async function requestSwap(req, res, next) {
  try {
    const requesterId = req.user.id;
    const { circle_id, target_user_id, reason } = req.body;

    if (!circle_id || !target_user_id) {
      return errorResponse(res, 'رقم الجمعية ومعرف العضو المراد التبادل معه مطلوبان', 'VALIDATION_ERROR', 400);
    }

    if (requesterId === parseInt(target_user_id, 10)) {
      return errorResponse(res, 'لا يمكنك طلب التبادل مع نفسك', 'VALIDATION_ERROR', 400);
    }

    const requesterTurn = await dbHelpers.get(
      'SELECT * FROM turns WHERE circle_id = ? AND assigned_user_id = ?',
      [circle_id, requesterId]
    );

    if (!requesterTurn) {
      return errorResponse(res, 'ليس لديك دور محدد في هذه الجمعية', 'TURN_NOT_FOUND', 404);
    }

    const targetTurn = await dbHelpers.get(
      'SELECT * FROM turns WHERE circle_id = ? AND assigned_user_id = ?',
      [circle_id, target_user_id]
    );

    if (!targetTurn) {
      return errorResponse(res, 'العضو المطلوب ليس لديه دور محدد في هذه الجمعية', 'TARGET_TURN_NOT_FOUND', 404);
    }

    // Set swap pending
    await dbHelpers.run(
      'UPDATE turns SET swap_pending_with_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [target_user_id, requesterTurn.id]
    );

    // Send notification to target user
    await dbHelpers.run(
      `INSERT INTO notifications (user_id, title, body, type, metadata)
       VALUES (?, ?, ?, 'turn_swap', ?)`,
      [
        target_user_id,
        'طلب تبادل دور في الجمعية',
        `طلب العضو ${req.user.name} تبادل الدور (${requesterTurn.round_number}) معك (دورك: ${targetTurn.round_number}). السبب: ${reason || 'لا يوجد'}`,
        JSON.stringify({ circle_id, requester_user_id: requesterId, requester_turn: requesterTurn.round_number, reason })
      ]
    );

    return successResponse(res, {
      message: 'تم إرسال طلب التبادل بنجاح وبانتظار موافقة الطرف الآخر',
      requester_round: requesterTurn.round_number,
      target_round: targetTurn.round_number
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Respond to Turn Swap Request
 * PUT /api/turns/swap-respond
 */
async function respondSwap(req, res, next) {
  try {
    const currentUserId = req.user.id;
    const { circle_id, requester_user_id, action } = req.body;

    if (!circle_id || !requester_user_id || !action) {
      return errorResponse(res, 'بيانات طلب التبادل غير مكتملة', 'VALIDATION_ERROR', 400);
    }

    const requesterTurn = await dbHelpers.get(
      'SELECT * FROM turns WHERE circle_id = ? AND assigned_user_id = ? AND swap_pending_with_user_id = ?',
      [circle_id, requester_user_id, currentUserId]
    );

    if (!requesterTurn) {
      return errorResponse(res, 'لا يوجد طلب تبادل معلق من هذا العضو', 'SWAP_REQUEST_NOT_FOUND', 404);
    }

    const targetTurn = await dbHelpers.get(
      'SELECT * FROM turns WHERE circle_id = ? AND assigned_user_id = ?',
      [circle_id, currentUserId]
    );

    if (action === 'reject') {
      await dbHelpers.run(
        'UPDATE turns SET swap_pending_with_user_id = NULL WHERE id = ?',
        [requesterTurn.id]
      );

      await dbHelpers.run(
        `INSERT INTO notifications (user_id, title, body, type, metadata)
         VALUES (?, ?, ?, 'turn_swap', ?)`,
        [
          requester_user_id,
          'تم رفض طلب تبادل الدور',
          `اعتذر العضو ${req.user.name} عن قبول طلب تبادل الدور.`,
          JSON.stringify({ circle_id, action: 'reject' })
        ]
      );

      return successResponse(res, { status: 'rejected' }, 'تم رفض طلب التبادل');
    }

    if (action === 'accept') {
      // Perform swap in turns table
      await dbHelpers.run(
        'UPDATE turns SET assigned_user_id = ?, swap_pending_with_user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [currentUserId, requesterTurn.id]
      );

      await dbHelpers.run(
        'UPDATE turns SET assigned_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [requester_user_id, targetTurn.id]
      );

      // Update circle_members assigned_turn
      await dbHelpers.run(
        'UPDATE circle_members SET assigned_turn = ? WHERE circle_id = ? AND user_id = ?',
        [requesterTurn.round_number, circle_id, currentUserId]
      );

      await dbHelpers.run(
        'UPDATE circle_members SET assigned_turn = ? WHERE circle_id = ? AND user_id = ?',
        [targetTurn.round_number, circle_id, requester_user_id]
      );

      // Update rounds beneficiaries
      await dbHelpers.run(
        'UPDATE rounds SET beneficiary_user_id = ? WHERE circle_id = ? AND round_number = ?',
        [currentUserId, circle_id, requesterTurn.round_number]
      );

      await dbHelpers.run(
        'UPDATE rounds SET beneficiary_user_id = ? WHERE circle_id = ? AND round_number = ?',
        [requester_user_id, circle_id, targetTurn.round_number]
      );

      // Notify requester
      await dbHelpers.run(
        `INSERT INTO notifications (user_id, title, body, type, metadata)
         VALUES (?, ?, ?, 'turn_swap', ?)`,
        [
          requester_user_id,
          'تمت الموافقة على تبادل الدور بالتراضي',
          `وافق العضو ${req.user.name} على تبادل الدور معك. دورك الجديد هو رقم ${targetTurn.round_number}.`,
          JSON.stringify({ circle_id, new_round: targetTurn.round_number })
        ]
      );

      return successResponse(
        res,
        {
          status: 'accepted',
          my_new_round: requesterTurn.round_number,
          requester_new_round: targetTurn.round_number
        },
        'تم قبول التبادل بنجاح وتحديث جدول الأدوار بالتراضي'
      );
    }

    return errorResponse(res, 'الإجراء غير مدعوم، استخدم accept أو reject', 'INVALID_ACTION', 400);
  } catch (error) {
    next(error);
  }
}

/**
 * Get Pending Swap Requests for Current User
 * GET /api/turns/pending-swaps
 */
async function getPendingSwaps(req, res, next) {
  try {
    const userId = req.user.id;

    // Incoming requests: where someone requested to swap with current user
    const incoming = await dbHelpers.all(
      `SELECT t.id as turn_id, t.circle_id, c.name as circle_name,
              t.round_number as requester_round, t.assigned_user_id as requester_id,
              u.name as requester_name, u.phone as requester_phone, u.trust_score as requester_trust_score,
              my_turn.round_number as my_round
       FROM turns t
       JOIN circles c ON t.circle_id = c.id
       JOIN users u ON t.assigned_user_id = u.id
       JOIN turns my_turn ON my_turn.circle_id = t.circle_id AND my_turn.assigned_user_id = ?
       WHERE t.swap_pending_with_user_id = ?`,
      [userId, userId]
    );

    // Outgoing requests: where current user sent a request to someone else
    const outgoing = await dbHelpers.all(
      `SELECT t.id as turn_id, t.circle_id, c.name as circle_name,
              t.round_number as my_round, t.swap_pending_with_user_id as target_id,
              u.name as target_name, u.phone as target_phone,
              target_turn.round_number as target_round
       FROM turns t
       JOIN circles c ON t.circle_id = c.id
       JOIN users u ON t.swap_pending_with_user_id = u.id
       JOIN turns target_turn ON target_turn.circle_id = t.circle_id AND target_turn.assigned_user_id = u.id
       WHERE t.assigned_user_id = ? AND t.swap_pending_with_user_id IS NOT NULL`,
      [userId]
    );

    return successResponse(res, { incoming, outgoing });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  executeDraw,
  getTurns,
  requestSwap,
  respondSwap,
  getPendingSwaps
};
