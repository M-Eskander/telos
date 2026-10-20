const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requireAuthenticated } = require('../middleware/auth.middleware');
const createTokenBucketRateLimiter = require('../middleware/rateLimit.middleware');

// Stricter limit for verification mail resends (5 per 15 minutes per IP).
const resendVerificationLimiter = createTokenBucketRateLimiter(['/resend-verification'], {
  capacity: 5,
  refillRate: 5 / (15 * 60),
  message: 'Too many verification emails requested, please try again later.'
});

// Password reset mail is also a public, mail-sending endpoint.
const forgotPasswordLimiter = createTokenBucketRateLimiter(['/forgot-password'], {
  capacity: 10,
  refillRate: 10 / (15 * 60),
  message: 'Too many password reset emails requested, please try again later.'
});

const resetPasswordLimiter = createTokenBucketRateLimiter(['/reset-password'], {
  capacity: 10,
  refillRate: 10 / (15 * 60),
  message: 'Too many attempts, please try again later.'
});

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', authController.me);
router.post('/bootstrap-owner', authController.bootstrapOwner);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, authController.resendVerification);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/change-password', requireAuthenticated, authController.changePassword);

module.exports = router;
