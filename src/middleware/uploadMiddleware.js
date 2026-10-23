const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { UPLOAD_DIR, MAX_FILE_SIZE } = require('../config/env');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const paymentId = req.params.id || 'payment';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedFilename = `rec_${paymentId}_${timestamp}${ext}`;
    cb(null, sanitizedFilename);
  }
});

// File filter (images only: jpg, jpeg, png, webp, pdf)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ];

  if (allowedExtensions.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('الملف غير مدعوم! يسمح فقط برفع الصور (JPG, PNG, WebP) أو ملفات PDF.'), false);
  }
};

const uploadReceipt = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter
});

module.exports = {
  uploadReceipt
};
