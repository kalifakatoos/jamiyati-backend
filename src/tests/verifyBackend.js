/**
 * Verification Test Suite for Jamiyati Backend
 * Pure P2P Islamic ROSCA Platform
 */

const path = require('path');
const fs = require('fs');
const { app } = require('../index');
const dbHelpers = require('../database/db');
const logger = require('../utils/logger');

const TEST_PORT = 4001;
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server;

async function runTests() {
  logger.info('=== Starting Jamiyati Backend Full Verification Suite ===');

  // Start test server
  await dbHelpers.initSchema();
  server = app.listen(TEST_PORT);
  logger.success(`Test server listening on port ${TEST_PORT}`);

  try {
    // 1. Health Check
    logger.info('Test 1: Health check endpoint');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthJson = await healthRes.json();
    if (healthRes.status !== 200 || healthJson.status !== 'healthy') {
      throw new Error(`Health check failed: ${JSON.stringify(healthJson)}`);
    }
    logger.success('Test 1 Passed: /api/health returns healthy status');

    // 2. Register User 1 (Admin/Creator)
    logger.info('Test 2: Register User 1 (Creator)');
    const randPhone1 = `+9665${Math.floor(10000000 + Math.random() * 90000000)}`;
    const regUser1Res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'عبد الله الشمري',
        phone: randPhone1,
        email: `abdullah_${Date.now()}@example.com`,
        password: 'Password123!',
        iban: 'SA4420000001234567890123',
        bank_name: 'مصرف الراجحي',
        payment_handle: 'abdullah@instapay'
      })
    });
    const regUser1Json = await regUser1Res.json();
    if (!regUser1Json.success || !regUser1Json.data.token) {
      throw new Error(`User 1 registration failed: ${JSON.stringify(regUser1Json)}`);
    }
    const tokenUser1 = regUser1Json.data.token;
    const user1 = regUser1Json.data.user;
    logger.success(`Test 2 Passed: User 1 registered with ID ${user1.id}, Trust Score: ${user1.trust_score}`);

    // 3. Register User 2 (Member)
    logger.info('Test 3: Register User 2 (Member)');
    const randPhone2 = `+9665${Math.floor(10000000 + Math.random() * 90000000)}`;
    const regUser2Res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'سعد القرني',
        phone: randPhone2,
        email: `saad_${Date.now()}@example.com`,
        password: 'Password123!',
        iban: 'SA0380000009876543210987',
        bank_name: 'مصرف الإنماء',
        payment_handle: 'saad@instapay'
      })
    });
    const regUser2Json = await regUser2Res.json();
    if (!regUser2Json.success || !regUser2Json.data.token) {
      throw new Error(`User 2 registration failed: ${JSON.stringify(regUser2Json)}`);
    }
    const tokenUser2 = regUser2Json.data.token;
    const user2 = regUser2Json.data.user;
    logger.success(`Test 3 Passed: User 2 registered with ID ${user2.id}`);

    // 4. Test Login
    logger.info('Test 4: Login with credentials');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: randPhone1,
        password: 'Password123!'
      })
    });
    const loginJson = await loginRes.json();
    if (!loginJson.success || !loginJson.data.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginJson)}`);
    }
    logger.success('Test 4 Passed: Login successful with JWT generation');

    // 5. Test Profile Me
    logger.info('Test 5: Get Current User Profile');
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenUser1}` }
    });
    const meJson = await meRes.json();
    if (!meJson.success || meJson.data.user.id !== user1.id) {
      throw new Error(`GET /auth/me failed: ${JSON.stringify(meJson)}`);
    }
    logger.success('Test 5 Passed: Profile fetched successfully');

    // 6. Create Circle (total_members = 2)
    logger.info('Test 6: Create ROSCA Circle (total_members = 2, amount = 1000 SAR)');
    const createCircleRes = await fetch(`${BASE_URL}/circles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser1}`
      },
      body: JSON.stringify({
        name: 'جمعية زملاء العمل التجريبية',
        description: 'جمعية تجريبية للتحقق من تكامل النظام',
        monthly_amount: 1000.0,
        currency: 'SAR',
        total_members: 2,
        frequency: 'monthly',
        start_date: '2026-11-01',
        payment_day_of_month: 27,
        turn_determination_method: 'random_draw'
      })
    });
    const createCircleJson = await createCircleRes.json();
    if (!createCircleJson.success || !createCircleJson.data.id) {
      throw new Error(`Create circle failed: ${JSON.stringify(createCircleJson)}`);
    }
    const circle = createCircleJson.data;
    logger.success(`Test 6 Passed: Circle created with ID ${circle.id}, Invite Code: ${circle.invite_code}`);

    // 7. User 2 Joins Circle using Invite Code
    logger.info('Test 7: User 2 joins circle via invite code');
    const joinRes = await fetch(`${BASE_URL}/circles/join/${circle.invite_code}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUser2}`
      }
    });
    const joinJson = await joinRes.json();
    if (!joinJson.success || !joinJson.data.is_ready_for_draw) {
      throw new Error(`Join circle failed: ${JSON.stringify(joinJson)}`);
    }
    logger.success('Test 7 Passed: User 2 joined circle; status transitioned to ready_for_draw');

    // 8. Execute Sharia Fair Draw (with priority slot for User 1 at Round 1)
    logger.info('Test 8: Execute Sharia Fair Draw with Priority slot');
    const drawRes = await fetch(`${BASE_URL}/circles/${circle.id}/draw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser1}`
      },
      body: JSON.stringify({
        priority_slots: [
          {
            user_id: user1.id,
            round_number: 1,
            reason: 'حاجة طارئة بالتراضي'
          }
        ]
      })
    });
    const drawJson = await drawRes.json();
    if (!drawJson.success || !drawJson.data.draw_seed) {
      throw new Error(`Execute draw failed: ${JSON.stringify(drawJson)}`);
    }
    logger.success(`Test 8 Passed: Sharia Fair Draw executed with deterministic seed: ${drawJson.data.draw_seed.substring(0, 16)}...`);

    // 9. Fetch Turns Schedule
    logger.info('Test 9: Get Circle Turns Schedule');
    const turnsRes = await fetch(`${BASE_URL}/circles/${circle.id}/turns`, {
      headers: { Authorization: `Bearer ${tokenUser1}` }
    });
    const turnsJson = await turnsRes.json();
    if (!turnsRes.ok || turnsJson.data.turns.length !== 2) {
      throw new Error(`Get turns failed: ${JSON.stringify(turnsJson)}`);
    }
    logger.success(`Test 9 Passed: Schedule verified with ${turnsJson.data.turns.length} rounds`);

    // 10. Fetch Current Round & Payments
    logger.info('Test 10: Get Current Active Round');
    const roundRes = await fetch(`${BASE_URL}/circles/${circle.id}/rounds/current`, {
      headers: { Authorization: `Bearer ${tokenUser2}` }
    });
    const roundJson = await roundRes.json();
    if (!roundRes.ok || !roundJson.data.current_round) {
      throw new Error(`Get current round failed: ${JSON.stringify(roundJson)}`);
    }
    const currentRound = roundJson.data.current_round;
    const payments = roundJson.data.payments;
    if (payments.length === 0) {
      throw new Error('No payments generated for round 1');
    }
    const user2Payment = payments.find((p) => p.payer_id === user2.id);
    if (!user2Payment) {
      throw new Error('User 2 payment row not found in round 1');
    }
    logger.success(`Test 10 Passed: Active Round 1 found with beneficiary: ${currentRound.beneficiary.name}, Payment ID: ${user2Payment.payment_id}`);

    // 11. User 2 Uploads Receipt (Multipart)
    logger.info('Test 11: Upload transfer receipt via Multer');
    const dummyImageBuffer = Buffer.from('FAKE_PNG_IMAGE_CONTENT_FOR_TESTING');
    const formData = new FormData();
    const fileBlob = new Blob([dummyImageBuffer], { type: 'image/png' });
    formData.append('receipt_image', fileBlob, 'receipt_test.png');
    formData.append('transaction_ref', 'TXN-TEST-123456');
    formData.append('transfer_date', new Date().toISOString());
    formData.append('notes', 'تم التحويل عبر تطبيق مصرف الراجحي بنجاح');

    const uploadRes = await fetch(`${BASE_URL}/payments/${user2Payment.payment_id}/upload-receipt`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUser2}`
      },
      body: formData
    });
    const uploadJson = await uploadRes.json();
    if (!uploadJson.success || uploadJson.data.status !== 'receipt_uploaded') {
      throw new Error(`Upload receipt failed: ${JSON.stringify(uploadJson)}`);
    }
    logger.success(`Test 11 Passed: Receipt uploaded, image url: ${uploadJson.data.receipt.image_url}`);

    // 12. Beneficiary (User 1) Confirms Receipt (Dual-Party Confirmation)
    logger.info('Test 12: Dual confirmation by Beneficiary (User 1)');
    const confirmRes = await fetch(`${BASE_URL}/payments/${user2Payment.payment_id}/confirm-receipt`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUser1}`
      },
      body: JSON.stringify({
        notes: 'تم التأكد من وصول الحوالة في الحساب البنكي'
      })
    });
    const confirmJson = await confirmRes.json();
    if (!confirmJson.success || confirmJson.data.status !== 'confirmed') {
      throw new Error(`Confirm receipt failed: ${JSON.stringify(confirmJson)}`);
    }
    logger.success(`Test 12 Passed: Payment confirmed, trust points awarded: ${confirmJson.data.trust_points_awarded}`);

    // 13. Verify Trust Score Updated for User 2 (80 + 3 = 83)
    logger.info('Test 13: Verify Trust Score & Badges for User 2');
    const trustRes = await fetch(`${BASE_URL}/users/${user2.id}/trust-score`, {
      headers: { Authorization: `Bearer ${tokenUser2}` }
    });
    const trustJson = await trustRes.json();
    if (!trustJson.success || trustJson.data.trust_score !== 83) {
      throw new Error(`Trust score not updated properly: ${JSON.stringify(trustJson)}`);
    }
    logger.success(`Test 13 Passed: User 2 Trust Score verified: ${trustJson.data.trust_score} (Tier: ${trustJson.data.tier}), Badges: ${trustJson.data.badges.map(b => b.name).join(', ')}`);

    logger.success('================================================================');
    logger.success('🎉 ALL 13 VERIFICATION TESTS PASSED SUCCESSFULLY!');
    logger.success('================================================================');
  } catch (error) {
    logger.error('Verification Test Failed:', error);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
      logger.info('Test server stopped.');
    }
    // Delete test probe if exists
    const probePath = path.join(__dirname, 'test_probe.js');
    if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    process.exit(process.exitCode || 0);
  }
}

runTests();
