const express = require('express');
const router = express.Router();
const turnController = require('../controllers/turnController');
const { authenticate } = require('../middleware/authMiddleware');

router.use(authenticate);

router.get('/pending-swaps', turnController.getPendingSwaps);
router.post('/swap-request', turnController.requestSwap);
router.put('/swap-respond', turnController.respondSwap);
router.get('/:circleId', turnController.getTurns);

module.exports = router;
