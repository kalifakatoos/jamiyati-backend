const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/authMiddleware');
const { uploadReceipt } = require('../middleware/uploadMiddleware');

router.use(authenticate);

// Get single payment details
router.get('/:id', paymentController.getPaymentById);

// Receipt upload via Multer (multipart/form-data)
router.post('/:id/upload-receipt', uploadReceipt.single('receipt_image'), paymentController.uploadReceipt);

// Dual confirmation (التوثيق والإشهاد)
router.put('/:id/confirm-receipt', paymentController.confirmReceipt);

// Dispute
router.put('/:id/dispute', paymentController.disputePayment);

module.exports = router;
