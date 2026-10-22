const multer = require('multer');

const MAX_SHEET_SIZE = 8 * 1024 * 1024;

const parseSheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SHEET_SIZE, files: 1 }
}).single('sheet');

module.exports = (req, res, next) => {
  parseSheetUpload(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  });
};

module.exports.MAX_SHEET_SIZE = MAX_SHEET_SIZE;
