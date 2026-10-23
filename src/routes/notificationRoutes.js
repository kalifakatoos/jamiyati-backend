const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/', paymentController.getUserNotifications);
router.put('/:id/read', paymentController.markNotificationRead);

module.exports = router;
