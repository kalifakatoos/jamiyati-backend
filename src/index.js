const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT, UPLOAD_DIR } = require('./config/env');
const dbHelpers = require('./database/db');
const apiRoutes = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Global Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static route for uploaded receipts
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Root & Health Checks
app.get('/', (req, res) => {
  res.json({
    message: 'مرحباً بكم في منصة جمعيتي (Jamiyati) - تطبيق إدارة الجمعيات المالية بنظام القرض الحسن',
    version: '1.0.0',
    documentation: '/api/health',
    port: PORT
  });
});

// API Routes Aggregation
app.use('/api', apiRoutes);

// 404 Fallback Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `المسار المطلوب (${req.originalUrl}) غير موجود`,
      details: null
    }
  });
});

// Central Error Handler
app.use(errorHandler);

// Start Server and Bootstrap Database
async function startServer() {
  try {
    // Ensure DB schema and tables exist
    await dbHelpers.initSchema();

    // Auto-seed demo data if users table is empty (e.g. on fresh Render deployment)
    const userRow = await dbHelpers.get('SELECT COUNT(*) as cnt FROM users');
    if (!userRow || userRow.cnt === 0) {
      logger.info('Database is empty. Running initial demo seed...');
      const seedFunc = require('./database/seed');
      await seedFunc();
    }

    const server = app.listen(PORT, () => {
      logger.success(`====================================================`);
      logger.success(`🚀 Jamiyati Backend API is actively listening on port ${PORT}`);
      logger.success(`🌐 Base API URL: http://localhost:${PORT}/api`);
      logger.success(`📁 Uploads Directory: ${UPLOAD_DIR}`);
      logger.success(`🕌 Islamic ROSCA Governance: Pure P2P Qard Hasan`);
      logger.success(`====================================================`);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Auto-run if executed directly
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
