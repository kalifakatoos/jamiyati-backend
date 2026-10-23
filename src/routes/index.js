const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const circleRoutes = require('./circleRoutes');
const turnRoutes = require('./turnRoutes');
const paymentRoutes = require('./paymentRoutes');
const trustRoutes = require('./trustRoutes');
const notificationRoutes = require('./notificationRoutes');

// API Health Check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'jamiyati-backend',
    timestamp: new Date().toISOString(),
    governance: 'Pure P2P Islamic ROSCA (Qard Hasan)'
  });
});

// Mount modules
router.use('/auth', authRoutes);
router.use('/circles', circleRoutes);
router.use('/turns', turnRoutes);
router.use('/payments', paymentRoutes);
router.use('/users', trustRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;
