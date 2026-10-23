const express = require('express');
const router = express.Router();
const circleController = require('../controllers/circleController');
const turnController = require('../controllers/turnController');
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');

// All circle routes require authentication
router.use(authenticate);

// Circle CRUD & Join
router.post('/', circleController.createCircle);
router.get('/', circleController.listCircles);
router.get('/:id', circleController.getCircleById);
router.get('/:id/members', circleController.getCircleMembers);
router.post('/join/:inviteCode', circleController.joinCircleByCode);
router.post('/:id/leave', circleController.leaveCircle);

// Nested Turn & Draw routes
router.post('/:id/draw', turnController.executeDraw);
router.get('/:id/turns', turnController.getTurns);

// Nested Rounds routes
router.get('/:id/rounds/current', paymentController.getCurrentRound);
router.get('/:id/rounds/:roundNumber', paymentController.getRoundByNumber);
router.get('/:id/schedule', paymentController.getSchedule);

module.exports = router;
