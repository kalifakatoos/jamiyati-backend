const bcrypt = require('bcryptjs');
const dbHelpers = require('./db');
const { executeShariaFairDraw, calculateRoundDueDate } = require('../services/drawService');
const logger = require('../utils/logger');

async function seed() {
  try {
    logger.info('Starting Jamiyati Database Seeding...');

    // 1. Initialize schema
    await dbHelpers.initSchema();

    // 2. Clear old data for a clean seed
    await dbHelpers.run('DELETE FROM audit_logs');
    await dbHelpers.run('DELETE FROM notifications');
    await dbHelpers.run('DELETE FROM trust_logs');
    await dbHelpers.run('DELETE FROM receipts');
    await dbHelpers.run('DELETE FROM payments');
    await dbHelpers.run('DELETE FROM rounds');
    await dbHelpers.run('DELETE FROM turns');
    await dbHelpers.run('DELETE FROM circle_members');
    await dbHelpers.run('DELETE FROM circles');
    await dbHelpers.run('DELETE FROM guarantors');
    await dbHelpers.run('DELETE FROM users');

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('password123', salt);

    // 3. Seed Users (Libya Localization)
    const usersData = [
      {
        name: 'عبد الله الشمري',
        phone: '0912345678',
        email: 'abdullah@example.com',
        iban: 'LY4400100100000001234567890',
        bank_name: 'مصرف الجمهورية (Jumhouria Bank)',
        payment_handle: '0912345678@sadad',
        trust_score: 95
      },
      {
        name: 'سعد الورفلي',
        phone: '0923456789',
        email: 'saad@example.com',
        iban: 'LY0300200200000009876543210',
        bank_name: 'مصرف الأمان (Aman Bank)',
        payment_handle: '0923456789@tadawul',
        trust_score: 88
      },
      {
        name: 'فيصل المقرحي',
        phone: '0915556677',
        email: 'faisal@example.com',
        iban: 'LY5500300300000005544332211',
        bank_name: 'مصرف الوحدة (Wahda Bank)',
        payment_handle: '0915556677@mobicash',
        trust_score: 85
      },
      {
        name: 'عمر الترهوني',
        phone: '0941112233',
        email: 'omar@example.com',
        iban: 'LY1200400400000001122334455',
        bank_name: 'مصرف التجارة والتنمية (BCD)',
        payment_handle: '0941112233@adfali',
        trust_score: 80
      },
      {
        name: 'طارق الزوي',
        phone: '0927778899',
        email: 'tariq@example.com',
        iban: 'LY9900500500000009988776655',
        bank_name: 'المصرف التجاري الوطني (NCB)',
        payment_handle: '0927778899@yousr',
        trust_score: 84
      }
    ];

    const userIds = [];
    for (const u of usersData) {
      const res = await dbHelpers.run(
        `INSERT INTO users (
          name, phone, email, password_hash, iban, bank_name, payment_handle, trust_score, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [u.name, u.phone, u.email, passwordHash, u.iban, u.bank_name, u.payment_handle, u.trust_score]
      );
      userIds.push({ id: res.lastID, ...u });
    }

    logger.success(`Seeded ${userIds.length} users with password 'password123'.`);

    // 4. Seed Circle
    const adminUser = userIds[0];
    const circleRes = await dbHelpers.run(
      `INSERT INTO circles (
        creator_id, name, description, monthly_amount, currency, total_members,
        frequency, start_date, payment_day_of_month, status, turn_determination_method, invite_code
      ) VALUES (?, ?, ?, 1000.0, 'LYD', 5, 'monthly', '2026-11-01', 27, 'open', 'random_draw', 'JAM-7729-TIP')`,
      [
        adminUser.id,
        'جمعية زملاء العمل - طرابلس',
        'جمعية ادخارية دورية لعام 2026 بنظام القرض الحسن والتكافل في ليبيا'
      ]
    );

    const circleId = circleRes.lastID;

    // Add all 5 users as circle members
    for (let i = 0; i < userIds.length; i++) {
      await dbHelpers.run(
        `INSERT INTO circle_members (circle_id, user_id, role, join_status)
         VALUES (?, ?, ?, 'joined')`,
        [circleId, userIds[i].id, i === 0 ? 'admin' : 'member']
      );
    }

    // 5. Execute Sharia Fair Draw with Priority slot for Faisal (userIds[2]) at round 1
    const memberSlots = userIds.map((u) => ({
      userId: u.id,
      userName: u.name,
      isMutualPriority: u.id === userIds[2].id,
      priorityRound: u.id === userIds[2].id ? 1 : undefined,
      priorityReason: u.id === userIds[2].id ? 'ظرف صحي عاجل بالتراضي' : undefined
    }));

    const drawResult = executeShariaFairDraw(circleId, memberSlots, 5, '2026-10-23T14:00:00.000Z');

    // Persist Turns, Rounds & Payments
    let firstRoundId = null;
    let roundOneBeneficiaryId = null;

    for (const item of drawResult.schedule) {
      const payoutDate = calculateRoundDueDate('2026-11-01', 27, item.roundNumber);

      await dbHelpers.run(
        `INSERT INTO turns (
          circle_id, round_number, assigned_user_id, payout_date, is_locked, is_mutual_priority, priority_reason
        ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [circleId, item.roundNumber, item.userId, payoutDate, item.isPriority ? 1 : 0, item.reason]
      );

      await dbHelpers.run(
        `UPDATE circle_members SET assigned_turn = ? WHERE circle_id = ? AND user_id = ?`,
        [item.roundNumber, circleId, item.userId]
      );

      const rStatus = item.roundNumber === 1 ? 'collecting' : 'scheduled';
      const roundRes = await dbHelpers.run(
        `INSERT INTO rounds (
          circle_id, round_number, beneficiary_user_id, expected_pool_amount, collected_amount, due_date, status
        ) VALUES (?, ?, ?, 4000.0, 0.0, ?, ?)`,
        [circleId, item.roundNumber, item.userId, payoutDate, rStatus]
      );

      if (item.roundNumber === 1) {
        firstRoundId = roundRes.lastID;
        roundOneBeneficiaryId = item.userId;
      }

      // Payments for this round
      for (const m of userIds) {
        if (m.id !== item.userId) {
          await dbHelpers.run(
            `INSERT INTO payments (
              round_id, circle_id, payer_id, beneficiary_id, expected_amount, status
            ) VALUES (?, ?, ?, ?, 1000.0, 'unpaid')`,
            [roundRes.lastID, circleId, m.id, item.userId]
          );
        }
      }
    }

    // Update Circle to Active
    await dbHelpers.run(
      `UPDATE circles
       SET status = 'active', draw_seed = ?, draw_executed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [drawResult.seed, circleId]
    );

    // 6. Demonstrate an uploaded receipt and confirmed payment in round 1
    // Pick first payer who is not the beneficiary
    const samplePayment = await dbHelpers.get(
      'SELECT id, payer_id, beneficiary_id FROM payments WHERE round_id = ? AND beneficiary_id = ? LIMIT 1',
      [firstRoundId, roundOneBeneficiaryId]
    );

    if (samplePayment) {
      await dbHelpers.run(
        `INSERT INTO receipts (
          payment_id, image_url, file_name, file_size, mime_type, transaction_ref, transfer_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [
          samplePayment.id,
          '/uploads/receipts/demo_receipt.png',
          'demo_receipt.png',
          245600,
          'image/png',
          'TXN-998841224LYD',
          'تم التحويل بنجاح عبر تطبيق مصرف الجمهورية (خدمة يسر)'
        ]
      );

      // Confirm the payment
      await dbHelpers.run(
        `UPDATE payments
         SET status = 'confirmed', paid_at = CURRENT_TIMESTAMP, confirmed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [samplePayment.id]
      );

      // Add trust log for confirmed payment
      await dbHelpers.run(
        `INSERT INTO trust_logs (user_id, change_amount, reason, circle_id, round_id)
         VALUES (?, 3, 'سداد مستحق الجمعية وتأكيد الاستلام شرعاً', ?, ?)`,
        [samplePayment.payer_id, circleId, firstRoundId]
      );
    }

    // 7. Seed Guarantors (الكفالة الشرعية)
    await dbHelpers.run(
      `INSERT INTO guarantors (user_id, guarantor_user_id, status, relationship, notes)
       VALUES (?, ?, 'accepted', 'زميل عمل موثوق', 'كفالة أخوية شرعية بنظام القرض الحسن')`,
      [userIds[1].id, userIds[0].id]
    );

    // 8. Seed Second Circle (Open for joining to test multiple circles)
    const circle2Res = await dbHelpers.run(
      `INSERT INTO circles (
        creator_id, name, description, monthly_amount, currency, total_members,
        frequency, start_date, payment_day_of_month, status, turn_determination_method, invite_code
      ) VALUES (?, ?, ?, 1500.0, 'LYD', 4, 'monthly', '2026-12-01', 1, 'open', 'random_draw', 'JAM-5544-BEN')`,
      [
        userIds[1].id,
        'جمعية التوفير العائلية - بنغازي',
        'جمعية ادخار عائلية للأقارب والأصدقاء في بنغازي'
      ]
    );
    const circle2Id = circle2Res.lastID;

    // Add Creator Saad and Admin Abdullah
    await dbHelpers.run(
      `INSERT INTO circle_members (circle_id, user_id, role, join_status)
       VALUES (?, ?, 'admin', 'joined')`,
      [circle2Id, userIds[1].id]
    );
    await dbHelpers.run(
      `INSERT INTO circle_members (circle_id, user_id, role, join_status)
       VALUES (?, ?, 'member', 'joined')`,
      [circle2Id, userIds[0].id]
    );

    // 9. Seed System & Reminder Notifications
    for (const u of userIds) {
      await dbHelpers.run(
        `INSERT INTO notifications (user_id, title, body, type, metadata)
         VALUES (?, ?, ?, 'system', ?)`,
        [
          u.id,
          'مرحباً بك في منصة جمعيتي',
          'تم تفعيل حسابك بنجاح بنظام القرض الحسن والتكافل المجتمعي 100% بدون أي فوائد ربوية.',
          JSON.stringify({ welcome: true })
        ]
      );
    }

    logger.success('✅ Seeding completed successfully with 2 Circles, Guarantors & Notifications!');
    logger.info(`Test Admin Login (Libya): Phone: ${adminUser.phone} | Password: password123`);
    logger.info(`Active Circle: JAM-7729-TIP (ID: ${circleId})`);
    logger.info(`Open Circle: JAM-5544-BEN (ID: ${circle2Id})`);
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error.message || error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

seed();
