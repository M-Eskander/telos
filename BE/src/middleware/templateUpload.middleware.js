const multer = require('multer');

const MAX_TEMPLATE_SIZE = 12 * 1024 * 1024;

// The layout of a project: the Word file with the placeholders in it, and
// optionally the PDF of it.
const parseTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TEMPLATE_SIZE, files: 2 },
  fileFilter: (req, file, callback) => {
    const name = String(file.originalname || '').toLowerCase();
    const isWord = name.endsWith('.docx');
    const isPdf = name.endsWith('.pdf');
    if (!isWord && !isPdf) {
      return callback(new TypeError('The layout must be a Word file (.docx) or a PDF'));
    }
    return callback(null, true);
  }
}).fields([
  { name: 'layout', maxCount: 1 },
  { name: 'contract', maxCount: 1 }
]);

module.exports = (req, res, next) => {
  parseTemplateUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  });
};

module.exports.MAX_TEMPLATE_SIZE = MAX_TEMPLATE_SIZE;
