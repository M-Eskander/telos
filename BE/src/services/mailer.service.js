// Minimal Resend (https://resend.com) mailer using the built-in fetch.
// The free tier (3,000 emails/month, 100/day) is enough for verification and
// password reset mail. When RESEND_API_KEY is not configured the mailer logs
// and skips sending so development and tests never reach the network.

const RESEND_API_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 5000;

function getConfig(env = process.env) {
  return {
    apiKey: typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '',
    from: env.MAIL_FROM || 'Telos <no-reply@telosstudio.games>',
    appBaseUrl: (env.APP_BASE_URL || 'https://team.telosstudio.games').replace(/\/+$/, '')
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared transport. Never throws: callers get { sent: false, ... } on failure
// so a mail outage can never break account creation or password recovery.
async function sendEmail({ to, subject, text, html, label }) {
  const config = getConfig();
  if (!config.apiKey) {
    console.warn(`[mailer] RESEND_API_KEY is not configured; skipping ${label} email to ${to}`);
    return { sent: false, skipped: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject,
        text,
        html
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[mailer] Resend rejected ${label} email to ${to}: ${response.status} ${detail}`);
      return { sent: false, status: response.status };
    }
    return { sent: true, status: response.status };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'request timed out' : error.message;
    console.error(`[mailer] Failed to send ${label} email to ${to}: ${reason}`);
    return { sent: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function sendVerificationEmail({ to, name, verifyUrl }) {
  const safeName = escapeHtml(name || 'there');
  const subject = 'Verify your Telos email address';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'Confirm your email address to activate your Telos account:',
    verifyUrl,
    '',
    'This link expires in 24 hours. If you did not expect this email, you can ignore it.'
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.5;">
    <p>Hi ${safeName},</p>
    <p>Confirm your email address to activate your Telos account:</p>
    <p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">Verify my email</a></p>
    <p>This link expires in 24 hours. If you did not expect this email, you can ignore it.</p>
    <p style="color:#6b7280;font-size:12px;">If the button does not work, copy this address into your browser:<br>${escapeHtml(verifyUrl)}</p>
  </body>
</html>`;

  return sendEmail({ to, subject, text, html, label: 'verification' });
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = escapeHtml(name || 'there');
  const subject = 'Reset your Telos password';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'We received a request to reset your Telos password. Choose a new password here:',
    resetUrl,
    '',
    'This link expires in 1 hour and can only be used once.',
    'If you did not request this, you can ignore this email; your password will not change.'
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1f2937; line-height: 1.5;">
    <p>Hi ${safeName},</p>
    <p>We received a request to reset your Telos password. Choose a new password here:</p>
    <p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;border-radius:6px;text-decoration:none;">Reset my password</a></p>
    <p>This link expires in 1 hour and can only be used once. If you did not request this, you can ignore this email; your password will not change.</p>
    <p style="color:#6b7280;font-size:12px;">If the button does not work, copy this address into your browser:<br>${escapeHtml(resetUrl)}</p>
  </body>
</html>`;

  return sendEmail({ to, subject, text, html, label: 'password reset' });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, getConfig };
