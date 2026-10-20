const mailerService = require('../../src/services/mailer.service');

describe('mailer service', () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAIL_FROM: process.env.MAIL_FROM,
    APP_BASE_URL: process.env.APP_BASE_URL
  };

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  test('skips sending when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await mailerService.sendVerificationEmail({
      to: 'person@example.com',
      name: 'Person',
      verifyUrl: 'https://example.com/verify-email.html?token=abc'
    });

    expect(result).toEqual({ sent: false, skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('posts the verification email to the Resend API when configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.MAIL_FROM = 'Telos <no-reply@telosstudio.games>';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const verifyUrl = 'https://team.example.com/verify-email.html?token=abc123';
    const result = await mailerService.sendVerificationEmail({
      to: 'person@example.com',
      name: 'Person <script>',
      verifyUrl
    });

    expect(result).toEqual({ sent: true, status: 200 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    const payload = JSON.parse(options.body);
    expect(payload.from).toBe('Telos <no-reply@telosstudio.games>');
    expect(payload.to).toEqual(['person@example.com']);
    expect(payload.text).toContain(verifyUrl);
    expect(payload.html).toContain(verifyUrl);
    expect(payload.html).not.toContain('<script>');
  });

  test('posts the password reset email to the Resend API when configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.MAIL_FROM = 'Telos <no-reply@telosstudio.games>';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const resetUrl = 'https://team.example.com/reset-password?token=abc123';
    const result = await mailerService.sendPasswordResetEmail({
      to: 'person@example.com',
      name: 'Person <script>',
      resetUrl
    });

    expect(result).toEqual({ sent: true, status: 200 });
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.to).toEqual(['person@example.com']);
    expect(payload.subject).toMatch(/reset/i);
    expect(payload.text).toContain(resetUrl);
    expect(payload.text).toMatch(/1 hour/);
    expect(payload.html).toContain(resetUrl);
    expect(payload.html).not.toContain('<script>');
  });

  test('reports delivery failure without throwing when Resend rejects', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'invalid from address'
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await mailerService.sendVerificationEmail({
      to: 'person@example.com',
      name: 'Person',
      verifyUrl: 'https://example.com/verify-email.html?token=abc'
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe(422);
  });
});
