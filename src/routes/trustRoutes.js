const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/:id/trust-score', paymentController.getUserTrustScore);
router.get('/:id/badges', async (req, res, next) => {
  // Aliased to trust score badges for convenience
  paymentController.getUserTrustScore(req, res, next);
});

module.exports = router;
