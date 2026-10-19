const multer = require('multer');
const { MAX_CONTRACT_SIZE } = require('../services/contractStorage.service');

const parseContractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CONTRACT_SIZE, files: 1 }
}).single('contract');

module.exports = (req, res, next) => {
  parseContractUpload(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  });
};
